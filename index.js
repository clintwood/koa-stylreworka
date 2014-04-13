/*
 * Module dependencies.
 */

var debug = require('debug')('koa-stylreworker');
var co    = require('co');
var fs    = require('fs');
var cofs  = require('co-fs');
var path  = require('path');
var crc   = require('buffer-crc32').signed;

var rework       = require('rework');
var whitespace   = require('css-whitespace');
var autoprefixer = require('autoprefixer')

/**
 * Return koajs middleware with styl-like css-whitespace - reworkcss - autoprefixer pipeline.
 *   `src`          {String} required - root dir for .styl files
 *   `dest`         {String} optional, default: src - root dir for .css files
 *   `transformPath`{function(reqPath):string} optional - function to allow url path transforms
 *   `force`        {Boolean} optional, default: false - when true, always compile
 *   `reworkcss`    {function(reworkcss, String):String} optional - function to rework css using reworkcss/rework
 *   `autoprefixer` {function(autoprefixer, String):String} optional - function to prefix css using ai/autoprefixer
 */
module.exports = function stylreworker(options) {

  options = options || {};
  if ('string' == typeof options)
    options = { src: options };

  // must have a src
  if (!options.src)
    throw new Error('Options: options.src is required.')

  // default dst to src
  options.dest = options.dest || options.src;

  // these must be functions
  if (options.transformPath && 'function' !== typeof options.transformPath)
    throw new Error('Options: options.transformPath must be a function.');
  if (options.reworkcss && 'function' !== typeof options.reworkcss)
    throw new Error('Options: options.reworkcss must be a function.');
  if (options.autoprefixer && 'function' !== typeof options.autoprefixer)
    throw new Error('Options: options.autoprefixer must be a function.');
  
  // defaults if not provided
  options.transformPath = options.transformPath || function(path) { return path; };

  var cache = {};

  // check mtimes
  function *checkMtimes(target) {
    var files = cache[target].files = cache[target].files || [];
    
    // does target exist and are there mtimes
    if (!(yield cofs.exists(target)) || cache[target].files.length == 0) {
      cache[target].files = []; // reset
      return true;
    }

    // get mtime of target with dependants
    var tmtime = (yield cofs.stat(target)).mtime.getTime();

    var results = yield files.map(function(file) {
      return function(done) {
        fs.stat(file, function(err, stat) {
          if (err) return done(err);
          done(null, stat.mtime.getTime());
        });
      }
    });

    // fail on at least one newer mtime
    return results.some(function (dmtime) { return (tmtime < dmtime); });
  }

  // css @import resolver (updates dependants)
  function importResolver(root, target) {
    var files = cache[target].files = cache[target].files || [];
    
    return function(p) {
      // only match .styl extension or no extension at all
      var match = p.match(/^['"]?(.+?)(?:\.styl)?['"]?$/);
      if (match) {
        var file = path.join(root, match[1]) + '.styl'
        if (fs.existsSync(file)) {
          debug('resolved ' + match[1] + '.styl');
          files.push(file);
          return fs.readFileSync(file, 'utf8');
        }
      }
      debug('unresolved ' + p);
      return null;
    }
  }

  // handle *.css requests, for now assumes src files are *.styl
  return function *stylreworker(next) {

    // filter on HTTP GET/HEAD & *.css resource
    if (('GET' !== this.method && 'HEAD' !== this.method) || !/\.css$/.test(this.path))
      return yield *next;

    var dst  = path.join(options.dest, this.path);
    var src  = path.join(options.dest, options.transformPath(this.path.replace('.css', '.styl')));

    // if src doesn't exist hand off downstream
    if (!fs.existsSync(src))
      return yield *next;

    // init cache for requested resource
    cache[dst] = cache[dst] || {};
    var css; 
    // check mtimes (including @import mtimes)
    var changed = yield checkMtimes(dst);
    if (options.force || changed) {
      
      debug('rebuilding ' + this.path);
      
      // css-whitespace
      css = whitespace('@import ' + path.basename(src), {
        resolver: importResolver(path.dirname(src), dst)
      });
      
      // reworkcss
      if (css && options.reworkcss)
        css = options.reworkcss(rework, css);
      
      // autoprefixer
      if (css && options.autoprefixer)
        css = options.autoprefixer(autoprefixer, css);
      
      // calc etag
      cache[dst].etag = crc(css);

      // response
      this.body = css;
      this.status = 200;
      this.set('Content-Type', 'text/css');
      this.set('ETag', '"' + cache[dst].etag + '"');
      // save
      yield cofs.writeFile(dst, css, 'utf8');
    } else {
      // prep for freshness check
      this.status = 200;
      this.set('ETag', '"' + cache[dst].etag + '"');
      // fresh?
      if (this.fresh) {
        debug('request is fresh ' + this.path);
        this.status = 304;
      } else {
        debug('request is stale ' + this.path);
        css = yield cofs.readFile(dst, 'utf8');
        this.body = css;
        this.set('Content-Type', 'text/css');
      }
    }
    
    // allow downstream middlewares to do work
    yield *next;
  }
};
