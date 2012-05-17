var util = require('util'),
    url = require('url'),
    http = require('http'),
    fs = require('fs'),
    path = require('path'),
    glob = require('glob'),
    async = require('async');

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

var getMetadata = function(id, phpsessid, callback) {
  if(id in metadataCache) {
    return metadataCache[id];
  }
  http.get({
    host: 'iphone.pxv.jp',
    port: 80,
    path: util.format('/iphone/illust.php?illust_id=%d&PHPSESSID=%s&p=1', id, phpsessid),
  },
  function(response) {
    var result = [];
    response.on('data', function(chunk) {
      result.push(chunk);
    });
    response.on('end', function() {
      var m = result.join('').split(',').map(function(s) { return s.replace(/"/g, ''); });
      var author = m[5];
      var title = m[3];
      var type = m[2];

      var metadata = {
        type: m[2],
        title: m[3],
        author: m[5]
      };
      metadataCache[id] = metadata;
      callback(metadata);
    });
  });
};

http.createServer(function(req, res) {
  var requestUrl = url.parse(req.url);
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
  if(/^img\d+\.pixiv\.net$/.test(requestUrl.hostname)) {
    if(/^\/img\/[\w\-]+\/(\d+)(?:_p(\d+))?\.\w+$/.test(requestUrl.pathname)) {
      var id = parseInt(RegExp.$1, 10),
          page = RegExp.$2.length > 0 ? parseInt(RegExp.$2, 10) + 1 : null;

      var phpsessid = /PHPSESSID=(\w+);/.test(req.headers['cookie']) && RegExp.$1;

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
          async.parallel([
            // image
            function(callback) {
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
                  callback(null, response.statusCode == 200 ? result.join('') : null);
                });
              });
            },
            // metadata
            function(callback) {
              getMetadata(id, phpsessid, function(data) {
                callback(null, data);
              });
            }
          ],
          function(err, results) {
            if(err) { throw err; }

            var image = results[0];
            var metadata = results[1];

            if(image) {
              var name = util.format('%d%s_%s_%s.%s', id, page ? util.format('_%s', paddingLeft(page, 4, '0')) : '', metadata.author, metadata.title, metadata.type).replace(/[\/\*\:\?]/g, '_');

              fs.writeFile(root + '/' + name, image, 'binary', function(err) {
                if(err) { throw err; }
              });
            }
          });
        }
      });

      return;
    }
  }
  http.get({
    host: req.headers.host,
    port: requestUrl.port || 80,
    path: requestUrl.path,
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
}).listen(port);