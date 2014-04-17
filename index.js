/*
 * Module dependencies.
 */

var debug = require('debug')('koa-stylreworka');
var fs = require('fs');
var cofs = require('co-fs');
var path = require('path');
var crc = require('buffer-crc32').signed;

var rework = require('rework');
var whitespace = require('css-whitespace');
var autoprefixer = require('autoprefixer')

/**
 * Return koajs middleware with styl-like css-whitespace - reworkcss - autoprefixer pipeline.
 *   `src`          {String} required - root dir for .styl files
 *   `dest`         {String} optional, default: src - root dir for .css files
 *   `transformPath`{function(reqPath):string} optional - function to allow url path transforms
 *   `force`        {Boolean} optional, default: false - when true, always compile
 *   `reworkcss`    {function(reworkcss, String):String} optional - function to rework css using reworkcss/rework
 *   `autoprefixer` {function(autoprefixer, String):String} optional - function to prefix css using ai/autoprefixer
 *
 *  Note: Src files can be either .styl (whitespace significant files) or .css files. If both exists in src then
 *  .styl will be used.  .css files will skip the css-whitespace preprocessing and if src & dest are the same and 
 *  no .styl file exists in that location the .css will be served as a static css file with no preprocessing.
 */
module.exports = function stylreworka(options) {

  options = options || {};
  if ('string' == typeof options)
    options = {
      src: options
    };

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
  options.transformPath = options.transformPath || function(path) {
    return path;
  };

  var cache = {};

  // check mtimes
  function * checkMTimes(target) {
    var tcache = cache[target];

    if (!tcache.mtime)
      return false;

    // get mtime of target and
    var tmtime = (yield cofs.stat(target)).mtime.getTime();
    // check against cached target mtime
    if (tmtime < tcache.mtime)
      return false;

    if (tcache.files) {
      // dependents
      for (var i = 0; i < tcache.files.length; i++) {
        if (!(yield cofs.exists(tcache.files[i])) || tmtime < (yield cofs.stat(tcache.files[i])).mtime.getTime())
          return false;
      }
    }

    return true;
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

  // handle *.css requests
  return function * stylreworka(next) {

    // filter on HTTP GET/HEAD & *.css resource
    if (('GET' !== this.method && 'HEAD' !== this.method) || !/\.css$/.test(this.path))
      return yield * next;

    var dst = path.join(options.dest, this.path);
    var dstExists = yield cofs.exists(dst);

    // init mtimes cache
    cache[dst] = cache[dst] || {};

    // check freshness if dst exists
    if (dstExists && !options.force && (yield checkMTimes(dst))) {
      // prep for freshness check
      this.status = 200;
      this.set('ETag', '"' + cache[dst].etag + '"');
      // fresh?
      if (this.fresh) {
        debug('css is fresh (' + this.path + ')');
        this.status = 304;
      } else {
        debug('css is stale (' + this.path + ')');
        this.body = yield cofs.readFile(dst, 'utf8');
        this.set('Content-Type', 'text/css');
      }
      return yield * next;
    }

    // probe for src & src type (.css/.styl)
    var src = path.join(options.src, options.transformPath(this.path));
    var dstEQsrc = (dst === src);
    var cssExists = yield cofs.exists(src);
    var stylExists = yield cofs.exists(src.replace('.css', '.styl'));
    var srcExists = (dstEQsrc && stylExists) || (!dstEQsrc && (cssExists || stylExists));

    // if dst & src don't exist hand off downstream
    if (!dstExists && !srcExists)
      return yield * next;

    // can only serve dst css
    if ((dstEQsrc && !stylExists) || (dstExists && !srcExists)) {
      // just serve static css if it exists
      debug('serving dst css (' + this.path + ')');
      this.status = 200;
      this.body = yield cofs.readFile(dst, 'utf8');
      cache[dst].etag = crc(this.body);
      cache[dst].mtime = (yield cofs.stat(dst)).mtime.getTime();
      this.set('Content-Type', 'text/css');
      this.set('ETag', '"' + cache[dst].etag + '"');
      return yield * next;
    }

    // preprocess
    var css;

    // if src is .styl
    if (stylExists) {
      debug('css-whitespace (' + this.path + ')');
      // css-whitespace
      src = src.replace('.css', '.styl');
      css = whitespace('@import ' + path.basename(src), {
        resolver: importResolver(path.dirname(src), dst)
      });
    }

    // if src is .css
    if (!css && cssExists) {
      debug('src is css (' + this.path + ')');
      css = yield cofs.readFile(src, 'utf8');
    }

    // reworkcss
    if (css && options.reworkcss) {
      debug('reworkcss (' + this.path + ')');
      css = options.reworkcss(rework, css);
    }

    // autoprefixer
    if (css && options.autoprefixer) {
      debug('autoprefixer (' + this.path + ')');
      css = options.autoprefixer(autoprefixer, css);
    }

    // calc etag
    cache[dst].etag = crc(css);

    // response
    debug('serving processed css (' + this.path + ')');
    this.body = css;
    this.status = 200;
    this.set('Content-Type', 'text/css');
    this.set('ETag', '"' + cache[dst].etag + '"');
    // save
    yield cofs.writeFile(dst, css, 'utf8');
    cache[dst].mtime = (yield cofs.stat(dst)).mtime.getTime();

    // allow downstream middlewares to do work
    yield * next;
  }
};