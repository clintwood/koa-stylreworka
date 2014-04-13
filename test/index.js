var request = require('supertest');
var should  = require('should');

var path    = require('path');
var fs      = require('fs');
var read    = fs.readFileSync;
var readdir = fs.readdirSync

var koa          = require('koa');
var stylreworker = require('..');

// basic testing of some reworkcss plugins
var colors     = require('rework-plugin-colors');
var easing     = require('rework-plugin-ease');
var references = require('rework-plugin-references');
var mixin      = require('rework-plugin-mixin');
var extend     = require('rework-inherit');
var mixins     = require('rework-mixins');


function transformPath(path) {
  return path.replace('css/', 'styles/');
}

function reworker(rework, css) {
  return rework(css)
    .use(colors())
    .use(easing())
    .use(extend())
    .use(references())
    .use(mixin(mixins))
    .toString({
      compress: false
    });
}

function prefixer(autoprefixer, css) {
  return autoprefixer()
    .process(css).css
}

var listen;
var app = koa();
app.use(
  stylreworker({
    src: __dirname,
    transformPath: transformPath,
    reworkcss: reworker,
    autoprefixer: prefixer
  })
);

describe('koa-stylreworker', function() {
  // startup
  before(function() {
    listen = app.listen();
  })

  // tests
  readdir('test/css').forEach(function(file) {
    if (!~file.indexOf('.out.css')) return;
    var base = path.basename(file).replace('.out.css', '');
    var src = '/css/' + base + '.css';
    var chk = path.join(__dirname ,'css', base + '.out.css');
    var tmp = chk.replace('.out', '');
    var out = read(chk, 'utf8');

    it(src, function(done) {
      request(listen)
        .get(src)
        .end(function(err, res) {
          res.should.have.status(200);
          res.text.should.equal(out);
          fs.unlinkSync(tmp);
          done();
        });
    });
  });

  // shutdown
  after(function() {
    listen.close();
  })
});