var stylreworker = require('..');

var koa = require('koa');
var etag = require('koa-etag');
var serve = require('koa-static');
var fresh = require('koa-fresh');
var compress = require('koa-compress');

var colors     = require('rework-plugin-colors');
var easing     = require('rework-plugin-ease');
var references = require('rework-plugin-references');
var mixin      = require('rework-plugin-mixin');
var extend     = require('rework-inherit');
var mixins     = require('rework-mixins');

var app = koa();

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

// try compatibility with other middlewares...
//app.use(fresh());
//app.use(etag());
//app.use(serve(__dirname, { defer: true }));

app.use(
  stylreworker({
    src: __dirname,
    transformPath: transformPath,
    reworkcss: reworker,
    autoprefixer: prefixer
  })
);

//// compress (gzip)
// app.use(compress({
//   filter: function (content_type) {
//     return /text/i.test(content_type)
//   },
//   threshold: 1024,
//   flush: require('zlib').Z_SYNC_FLUSH
// }));

app.listen(3000);
console.log('listening on port 3000');