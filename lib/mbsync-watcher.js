var path         = require('path')
var childprocess = require('child_process')
var Emitter      = require('events').EventEmitter
var fs           = require('fs')

/**
 * Watch for change in a mbsync dir
 *
 * @constructor
 * @extends EventEmitter
 * @param   Object  options   { channel, maildir, unimportant, important }
 */
function Mbsyncwatcher (options) {
  Emitter.call(this)

  var watcher       = this

  this.mbsync       = options.mbsync || 'mbsync'
  this.flags        = options.flags || ['-q']
  this.channel      = options.channel
  this.maildir      = path.resolve(options.maildir || __dirname)
  this.unimportant  = options.unimportant || []
  this.important    = options.important || []
  this.dependencies = options.dependencies || {}
  this.pool         = options.pool || 7
  this.mailboxes    = []
  this.boxpaths     = {}

  // Pool
  this.upcoming     = []
  this.pooled       = []

  this.updating     = {}

  this.mailboxes.push.apply(this.mailboxes, this.unimportant)
  this.mailboxes.push.apply(this.mailboxes, this.important)

  this.longtime     = options.longtime || 300000
  this.mediumtime   = options.mediumtime || 180000
  this.shorttime    = options.shorttime || 60000

  this._onchange = function onchange (box) {
    watcher.emit('watcher:change', box)
    watcher.emit('watcher:change:' + box)
  }

  var find = childprocess.execFile(
    'find'
  , [this.maildir, '-type', 'd']
  , function (err, stdout) {
      if (err) return watcher.emit('error', err)

      var files = stdout.trim().split('\n')
      watcher.loadboxes(files)
      watcher.emit('loaded', watcher)
    }
  )

  this.on('loaded', function () {
    setInterval(
      function () {
        watcher.emit('interval:longtime')
      }
    , watcher.longtime
    )
    setInterval(
      function () {
        watcher.emit('interval:mediumtime')
      }
    , watcher.mediumtime
    )
    setInterval(
      function () {
        watcher.emit('interval:shorttime')
      }
    , watcher.shorttime
    )

    this.update(this.mailboxes)
  })

  this.on('interval:longtime', this.updateunimportant)
  this.on('interval:mediumtime', this.updaterest)
  this.on('interval:shorttime', this.updateimportant)

  this.on('watcher:change', function (mailbox) {
    watcher.updatebox(mailbox)
  })

  this.on('process:exit', function () {
    var box = watcher.upcoming.shift()
    if (box) watcher.updatebox(box)
  })
}

module.exports = Mbsyncwatcher
var mwp        = Mbsyncwatcher.prototype
mwp.__proto__  = Emitter.prototype

/**
 * Load mailboxes from directory list
 *
 * @param   String  dirpaths
 */
mwp.loadboxes = function loadboxes (dirpaths) {
  var watcher  = this
  var box      = ''
  var dirpath  = ''
  var boxpath  = ''
  var boxhash  = {}

  for (var i = 0, il = dirpaths.length; i < il; i++) {
    dirpath = dirpaths[i]
    box     = this.pathtobox(dirpath)

    if (!box || boxhash[box]) continue

    boxpath      = this.pathtobox(dirpath, true)
    boxhash[box] = boxpath
  }

  this.mailboxes = Object.keys(boxhash)
  this.boxpaths  = boxhash

  this.mailboxes.forEach(function (mailbox) {
    if (~watcher.unimportant.indexOf(mailbox)) return
    var path = boxhash[mailbox]

    fs.watch(path + '/cur', function () {
      watcher._onchange(mailbox)
    })
    fs.watch(path + '/new', function () {
      watcher._onchange(mailbox)
    })
  })
}

/**
 * Reduce a file path to a mbsync mailbox
 *
 * @param   String  dirpath
 * @return  String
 */
mwp.pathtobox = function pathtobox (dirpath, full) {
  var folders = dirpath.slice(this.maildir.length + 1).split('/')
  var out     = []
  var folder  = ''
  var stop    = false

  for (var i = 0, il = folders.length; i < il; i++) {
    folder = folders[i]

    switch (folder) {
    case 'cur':
    case 'new':
    case 'tmp':
    case '.uidvalidity':
      stop = true
      break
    case 'Inbox':
      out.push('INBOX')
      stop = true
      break
    default:
      if (!full && '.' === folder[0]) {
        folder = folder.slice(1)
      }
      out.push(folder)
      break
    }

    if (stop) break
  }

  out = out.join('/')

  if (full) return path.join(this.maildir, out)

  return out
}

/**
 * Update unimportant
 */
mwp.updateunimportant = function updateunimportant () {
  this.update(this.unimportant)
}

/**
 * Update important
 */
mwp.updateimportant = function updateimportant () {
  this.update(this.important)
}

/**
 * Update the rest
 */
mwp.updaterest = function updaterest () {
  var rest = []

  for (var i = 0, il = this.mailboxes.length; i < il; i++) {
    if (~this.important.indexOf(this.mailboxes[i]))        continue
    else if (~this.unimportant.indexOf(this.mailboxes[i])) continue
    rest.push(this.mailboxes[i])
  }

  this.update(rest)
}

/**
 * Update some mailboxes
 *
 * @param   Array   mailboxes
 * @return  Mbsyncwatcher
 */
mwp.update = function update (mailboxes) {
  var watcher = this

  mailboxes.forEach(function (mailbox) {
    watcher.updatebox(mailbox)
  })

  return this
}

/**
 * Update a individual mailbox
 *
 * @param   String  mailbox
 * @return  Mbsyncwatcher
 */
mwp.updatebox = function updatebox (mailbox) {
  var watcher = this

  if (
     this.updating[mailbox]
  || ~this.upcoming.indexOf(mailbox)
  ) {
    return this
  }

  // Pooling
  if (this.pool <= this.pooled) {
    this.upcoming.push(mailbox)
    return this
  }

  ;++watcher.pooled

  var flags   = []
  flags.push.apply(flags, this.flags)
  flags.push(this.channel + ':' + mailbox)

  var starttime = Date.now()

  var mbsync = new childprocess.spawn(
    this.mbsync
  , flags
  )

  watcher.emit('process:spawn', mailbox, mbsync)
  watcher.emit('process:spawn:' + mailbox, mbsync)

  mbsync.stdout.resume()
  mbsync.stderr.resume()

  this.updating[mailbox] = true

  mbsync.on('exit', function () {
    ;--watcher.pooled

    var runtime = Date.now() - starttime
    watcher.emit('process:exit', mailbox, mbsync, runtime)
    watcher.emit('process:exit:' + mailbox, mbsync, runtime)

    watcher.updating[mailbox] = false

    if (watcher.dependencies[mailbox]) {
      watcher.update(watcher.dependencies[mailbox])
    }
  })

  return this
}

/**
 * Get uid of mailbox dir
 *
 * @param   String    mailbox
 * @param   Function  done
 * @return  Mbsyncwatcher
 */
mwp.getuid = function getuid (mailbox, done) {
  var watcher = this

  fs.readFile(
    path.join(this.boxpaths[mailbox], '.uidvalidity')
  , 'utf8'
  , done
  )

  return this
}

// vim: set filetype=javascript :
