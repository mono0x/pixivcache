var util = require('util'),
    url = require('url'),
    http = require('http'),
    fs = require('fs'),
    path = require('path'),
    glob = require('glob'),
    async = require('async'),
    $ = require('jquery');

var port = 1942;
var root = './cache';

var contentTypes = {
  'jpg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif'
};

var paddingLeft = function(input, n, ch) {
  var result = input.toString();
  while(result.length < n) {
    result = ch + result;
  }
  return result;
};

var getCache = function(id, page, callback) {
  var prefix = util.format('%d%s*', id, page ? util.format('_%s', paddingLeft(page, 4, '0')) : '');
  glob(root + '/**/' + prefix, {}, function(err, files) {
    callback(err, files[0]);
  });
};

var metadataCache = {};

http.createServer(function(req, res) {
  var requestUrl = url.parse(req.url, true);
  if(req.method != 'GET') {
    var body = [];
    req.on('data', function(data) {
      body.push(data);
    });
    req.on('end', function() {
      var request = http.request({
        host: req.headers.host,
        port: requestUrl.port || 80,
        path: requestUrl.path,
        method: req.method,
        headers: req.headers
      },
      function(response) {
        res.writeHead(response.statusCode, response.headers);
        response.on('data', function(chunk) {
          res.write(chunk);
        });
        response.on('end', function() {
          res.end();
        });
      });
      request.write(body.join(''));
      request.end();
    });
    return;
  }
  if(/^i\d+\.pixiv\.net$/.test(requestUrl.hostname)) {
    if(/^\/(?:img\d+\/)?img\/[\w\-]+\/(\d+)(?:_big)?(?:_p(\d+))?\.(\w+)$/.test(requestUrl.pathname)) {
      var id = parseInt(RegExp.$1, 10),
          page = RegExp.$2.length > 0 ? parseInt(RegExp.$2, 10) + 1 : null,
          type = RegExp.$3;

      getCache(id, page, function(err, file) {
        if(err) { throw err; }

        if(file) {
          async.parallel([
            // read
            function(callback) {
              fs.readFile(file, function(err, data) {
                if(err) { throw err; }
                callback(null, data);
              });
            },
            // stat
            function(callback) {
              fs.stat(file, function(err, stats) {
                if(err) { throw err; }
                callback(null, stats);
              });
            }
          ],
          function(err, results) {
            if(err) { throw err; }

            var image = results[0];
            var stats = results[1];

            var contentType = contentTypes[/\.(\w+)$/.test(file) && RegExp.$1.toLowerCase()];

            var date = new Date();
            var expires = new Date();
            expires.setFullYear(expires.getFullYear() + 1);

            res.writeHead(200, {
              'cache-control':  31536000,
              'content-length': stats.size,
              'content-type':   contentType,
              'date':           date.toUTCString(),
              'expires':        expires.toUTCString(),
              'last-modified':  stats.mtime.toUTCString()
            });
            res.write(image);
            res.end();
          });
        }
        else {
          // image
          var headers = JSON.parse(JSON.stringify(req.headers));
          delete headers['if-modified-since'];
          delete headers['if-none-match'];
          headers['referer'] = 'http://www.pixiv.net/';
          http.get({
            host: req.headers.host,
            port: url.parse(req.url).port || 80,
            method: 'GET',
            path: req.url,
            headers: headers
          },
          function(response) {
            var result = [];
            res.writeHead(response.statusCode, response.headers);
            response.setEncoding('binary');
            response.on('data', function(chunk) {
              res.write(chunk, 'binary');
              result.push(chunk);
            });
            response.on('end', function() {
              res.end();
              var image = response.statusCode == 200 ? result.join('') : null;
              var metadata = metadataCache[id];

              if(image && metadata) {
                var name = util.format('%d%s_%s_%s.%s', id, page ? util.format('_%s', paddingLeft(page, 4, '0')) : '', metadata.author, metadata.title, type).replace(/[\/\*\:\?]/g, '_');

                fs.writeFile(root + '/' + name, image, 'binary', function(err) {
                  if(err) { throw err; }
                });
              }
            });
          });
        }
      });

      return;
    }
  }
  delete req.headers['accept-encoding'];
  http.get({
    host: req.headers.host,
    port: requestUrl.port || 80,
    path: requestUrl.path,
    headers: req.headers
  },
  function(response) {
    var result = [];
    res.writeHead(response.statusCode, response.headers);
    response.on('data', function(chunk) {
      res.write(chunk);
      result.push(chunk);
    });
    response.on('end', function() {
      res.end();

      if(/^www\.pixiv\.net$/.test(requestUrl.hostname)) {
        if(/^\/member_illust.php$/.test(requestUrl.pathname)) {
          var id = parseInt(requestUrl.query.illust_id, 10);
          if(!(id in metadataCache)) {
            var html = result.join('');
            var doc = $(html);
            if(/^(?:\[R\-18\]\s*)?「(.+)」\/「(.+)」の(イラスト|漫画) \[pixiv\]$/.test(doc.find('title').text())) {
              var title = RegExp.$1;
              var author = RegExp.$2;

              metadataCache[id] = {
                title: title,
                author: author
              };
            }
          }
        }
      }
    });
  });
}).listen(port);

process.on('uncaughtException', function(err) {
  console.log('uncaughtException', err);
});
