'use strict'

angular.module 'com.module.common'

.factory 'torrentProvider', (torrentStore, streamServer, $q) ->
  serializeFiles = (torrent) ->
    pieceLength = torrent.torrent.pieceLength
    
    (torrent.files).map (f) ->
      start = f.offset / pieceLength | 0
      end = (f.offset + f.length - 1) / pieceLength | 0
      
      name: f.name
      path: f.path
      link: '/torrents/' + torrent.infoHash + '/files/' + encodeURIComponent(f.path)
      length: f.length
      offset: f.offset
      selected: torrent.selection.some (s) ->
        s.from <= start and s.to >= end

  getAllTorrentHashs: ->
    torrentStore.hashList()
    
  getAllTorrents: ->
    $q.when torrentStore.list

  addTorrentLink: (link) ->
    torrentStore.add link
    return

  uploadTorrent: (files) ->
    file = files and files.file

    if !file
      return 

    torrentStore.add file.path, (err, infoHash) ->
      if err
        console.error err
        return
      else
        return infoHash: infoHash

      fs.unlink file.path

  setStreamTorrent: (torrent) ->
    torrentFiles = serializeFiles torrent
    streamServer.run 'setTorrent', [torrentFiles]

  getTorrent: (hash) ->
    torrentStore.get hash

  startTorrent: (hash, index) ->
    torrent = torrentStore.get hash

    if index >= 0 and index < torrent.files.length
      torrent.files[index].select()
    else
      torrent.files.forEach (f) ->
        f.select()

  stopTorrent: (hash, index) ->
    torrent = torrentStore.get hash

    if index >= 0 and index < torrent.files.length
      torrent.files[index].deselect()
    else
      torrent.files.forEach (f) ->
        f.deselect()

  pauseSwarm: (hash) ->
    torrent = torrentStore.get hash
    torrent.swarm.pause()

  resumeSwarm: (hash) ->
    torrent = torrentStore.get hash
    torrent.swarm.resume()

  deleteTorrent: (hash) ->
    torrentStore.remove hash

  getStats: (hash) ->
    torrentStats torrentStore.get hash

  getM3UPlaylist: (hash) ->
    torrent = torrentStore.get hash

    playlist = '#EXTM3U\n' + torrent.files.map((f) ->
      '#EXTINF:-1,' + f.path + '\nhttp://127.0.0.1/torrents/' + torrent.infoHash + '/files/' + encodeURIComponent(f.path)
    ).join '\n'

    playlist