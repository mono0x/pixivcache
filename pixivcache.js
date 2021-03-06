var util = require('util'),
    url = require('url'),
    http = require('http'),
    fs = require('fs'),
    path = require('path'),
    glob = require('glob'),
    async = require('async'),
    mkdirp = require('mkdirp'),
    $ = require('jquery');

var port = 1942;
var root = './cache';
var thumbnail = './thumbnail';

var contentTypes = {
  'jpg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif'
};

var metadataCache = {};

function paddingLeft(input, n, ch) {
  var result = input.toString();
  while(result.length < n) {
    result = ch + result;
  }
  return result;
}

function findCache(id, page, callback) {
  var prefix = util.format('%d%s*', id, page ? util.format('_%s', paddingLeft(page, 4, '0')) : '');
  glob(root + '/**/' + prefix, {}, function(err, files) {
    callback(err, files[0]);
  });
}

function fileName(id, page, type, metadata) {
  var p = page ? util.format('_%s', paddingLeft(page, 4, '0')) : '';
  return util.format('%d%s_%s_%s.%s', id, p, metadata.author, metadata.title, type).replace(/[\/\*\:\?]/g, '_');
}

function proxyRequest(req, res, requestUrl) {
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
}

function proxyGet(req, res, requestUrl, callback) {
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
      if(callback) {
        result.push(chunk);
      }
    });
    response.on('end', function() {
      res.end();
      if(callback) {
        callback(result.join(''));
      }
    });
  });
}

function returnImage(req, res, requestUrl, id, page, type) {
  console.log('image', id, page, type);
  findCache(id, page, function(err, file) {
    if(err) { throw err; }

    if(file) {
      returnCache(res, file);
    }
    else {
      proxyImage(req, res, requestUrl, function(response, image) {
        var metadata = metadataCache[id];

        if(image && metadata) {
          console.log('store', metadata);
          fs.writeFile(root + '/' + fileName(id, page, type, metadata), image, 'binary', function(err) {
            if(err) { throw err; }
          });
        }
      });
    }
  });
}

function returnThumbnail(req, res, requestUrl, id, size, type) {
  console.log('thumbnail', id, type);
  var dir = util.format('%s/%s/%d', thumbnail, size, Math.floor(id / 10000));
  var path = util.format('%s/%d_%s.%s', dir, id, size, type);
  mkdirp(dir, {},function(err, made) {
    if(err) { throw err; }
    fs.exists(path, function(exists) {
      if(exists) {
        returnCache(res, path);
      }
      else {
        proxyImage(req, res, requestUrl, function(response, image) {
          if(image) {
            console.log('store', req.url);
            fs.writeFile(path, image, 'binary', function(err) {
              if(err) { throw err; }
            });
          }
        });
      }
    });
  });
}

function returnCache(res, file) {
  console.log('return cache', file);
  async.parallel([
    function(callback) {
      fs.readFile(file, function(err, data) {
        if(err) { throw err; }
        callback(null, data);
      });
    },
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

function proxyImage(req, res, requestUrl, callback) {
  console.log('get image', req.url);
  delete req.headers['if-modified-since'];
  delete req.headers['if-none-match'];
  req.headers['referer'] = 'http://www.pixiv.net/';
  http.get({
    host: req.headers.host,
    port: url.parse(req.url).port || 80,
    method: 'GET',
    path: req.url,
    headers: req.headers
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
      callback(response, image);
    });
  });
}

http.createServer(function(req, res) {
  var requestUrl = url.parse(req.url, true);
  if(req.method != 'GET') {
    proxyRequest(req, res, requestUrl);
    return;
  }

  if(/^i\d+\.pixiv\.net$/.test(requestUrl.hostname)) {
    if(/^\/(?:img\d+\/)?img\/[\w\-]+\/(\d+)(?:_big)?(?:_p(\d+))?\.(\w+)$/.test(requestUrl.pathname)) {
      returnImage(req, res, requestUrl, parseInt(RegExp.$1, 10), RegExp.$2.length > 0 ? parseInt(RegExp.$2, 10) + 1 : null, RegExp.$3);
      return;
    }
    if(/^\/(?:img\d+\/)?img\/[\w\-]+\/(\d+)_(s|m)\.(\w+)$/.test(requestUrl.pathname)) {
      returnThumbnail(req, res, requestUrl, parseInt(RegExp.$1, 10), RegExp.$2, RegExp.$3);
      return;
    }
  }

  delete req.headers['accept-encoding'];
  if(/^www\.pixiv\.net$/.test(requestUrl.hostname)) {
    if(/^\/member_illust.php$/.test(requestUrl.pathname)) {
      var id = parseInt(requestUrl.query.illust_id, 10);
      if(!(id in metadataCache)) {
        proxyGet(req, res, requestUrl, function(body) {
          var doc = $(body);
          if(/^(?:\[R\-18\]\s*)?「(.+)」\/「(.+)」の(イラスト|漫画) \[pixiv\]$/.test(doc.find('title').text())) {
            var title = RegExp.$1;
            var author = RegExp.$2;

            metadataCache[id] = {
              title: title,
              author: author
            };
          }
        });
        return;
      }
    }
  }
  proxyGet(req, res, requestUrl);
}).listen(port);

process.on('uncaughtException', function(e) {
  console.error('uncaughtException', e.stack);
});
