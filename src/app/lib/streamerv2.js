(function (App) {
    'use strict';

    var semver = require('semver');
    var peerflix = require('peerflix');
    var getPort = require('get-port');
    var crypto = require('crypto');
    var Streamer = Backbone.Model.extend({

        initialize: function () {
            this.updatedInfo = {};
            this.client = false;
            this.fileindex = null;
            this.streamDir = null;
            this.hasStarted = false;
            this.src = false;
            var self = this;
            App.vent.on('streamer:stop', _.bind(this.stop, this));
            App.vent.on('streamer:update', function (data) {
                if (!data) {
                    return;
                }
                for (var key in data) {
                    self.updatedInfo[key] = data[key];
                }
            });
        },

        start: function (data, preload) {
            this.hasStarted = true;
            var self = this;
            var streamPath = path.join(AdvSettings.get('tmpLocation'), data.metadata.title);
            getPort(function (err, port) {
                self.src = 'http://127.0.0.1:' + port;

                self.client = peerflix(data.torrent, {
                    connections: parseInt(Settings.connectionLimit, 10) || 100, // Max amount of peers to be connected to.
                    dht: parseInt(Settings.dhtLimit, 10) || 50,
                    port: port,
                    id: self.getPeerID(),
                    path: streamPath
                });

                self.client.on('ready', function () {

                    if (data.dropped) { //if this is a dropped torrent this will be true.

                        var streamableFiles = [];
                        self.client.files.forEach(function (file, index) {
                            if (file.name.endsWith('.avi') || file.name.endsWith('.mp4') || file.name.endsWith('.mkv') || file.name.endsWith('.wmv') || file.name.endsWith('.mov')) {
                                file.index = index;
                                streamableFiles.push(file);
                            }
                        });

                        App.vent.trigger('system:openFileSelector', new Backbone.Model({ //Open the file selctor if more than 1 file with streamable content is present in dropped torrent
                            files: streamableFiles,
                            torrent: data.torrent
                        }));

                        var startLoadingFromFileSelector = function () {
                            require('watchjs').unwatch(self.updatedInfo, 'fileSelectorIndex', startLoadingFromFileSelector); //Its been updated we dont need to watch anymore!
                            var index = self.updatedInfo.fileSelectorIndex;
                            var stream = self.client.files[index].createReadStream(); //begin stream
                            self.fileindex = index;
                        };
                        require('watchjs').watch(self.updatedInfo, 'fileSelectorIndex', startLoadingFromFileSelector); // watch for the updated info object to be updated with selected fileindex (from fileselector)


                    } else {
                        if (self.client) {
                            self.client.files.forEach(function (file) {
                                var index = self.client.files.reduce(function (a, b) { //find the biggest file and stream it.
                                    return a.length > b.length ? a : b;
                                });
                                index = self.client.files.indexOf(index);
                                var stream = self.client.files[index].createReadStream();
                                self.fileindex = index;
                                self.streamDir = path.dirname(path.join(streamPath, self.client.torrent.files[index].path));
                            });
                        }
                    }
                });
            });
            if (!preload) { //its not a preloading instance
                var stateModel = new Backbone.Model({
                    backdrop: data.metadata.backdrop,
                    title: data.metadata.title,
                    player: data.device,
                    show_controls: false,
                    data: data
                });

                App.vent.trigger('stream:started', stateModel);
            }
        },

        getPeerID: function () {
            var version = semver.parse(App.settings.version);
            var torrentVersion = '';
            torrentVersion += version.major;
            torrentVersion += version.minor;
            torrentVersion += version.patch;
            torrentVersion += version.prerelease.length ? version.prerelease[0] : 0;
            var torrentPeerId = '-PT';
            torrentPeerId += torrentVersion;
            torrentPeerId += '-';
            torrentPeerId += crypto.pseudoRandomBytes(6).toString('hex');
            return torrentPeerId;
        },
        logTotalUsage: function () {
            if (this.client.swarm && (this.client.swarm.downloaded || this.client.swarm.uploaded)) { //we want to be extra sure or we may corrupt the db
                var downloaded = this.client.swarm.downloaded;
                var uploaded = this.client.swarm.uploaded;
                AdvSettings.set('totalDownloaded', Settings.totalDownloaded + downloaded);
                AdvSettings.set('totalUploaded', Settings.totalUploaded + uploaded);
            }
        },
        stop: function () {
            console.info('Streamer destroyed');
            this.src = false;
            this.streamDir = null;
            this.hasStarted = false;
            this.fileindex = null;
            this.updatedInfo = {}; //reset the updated object back to empty
            if (this.client) {
                this.logTotalUsage();
                if (this.client.server._handle) {
                    this.client.server.close();
                }
                this.client.destroy();
            }
            this.client = false;
        }


    });

    App.Streamer = new Streamer();
})(window.App);
