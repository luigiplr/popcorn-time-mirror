/* globals moment*/
(function (App) {
    'use strict';
    var Q = require('q');
    var Eztv = App.Providers.get('Eztv');

    var Watchlist = function () {};
    Watchlist.prototype.constructor = Watchlist;

    var queryTorrents = function (filters) {
        var deferred = Q.defer();
        var now = moment();

        //Checked when last fetched
        App.Database.setting('get', {
                key: 'watchlist-fetched'
            })
            .then(function (doc) {
                if (doc) {
                    var d = moment.unix(doc);
                    if (Math.abs(now.diff(d, 'hours')) >= 12) {
                        win.info('Watchlist - last update was %s hour(s) ago', Math.abs(now.diff(d, 'hours')));
                        fetchWatchlist(true);
                    } else {
                        // Last fetch is fresh (< 12h)
                        win.info('Watchlist - next update in %s hour(s)', 12 - Math.abs(now.diff(d, 'hours')));
                        fetchWatchlist(false);
                    }
                } else {
                    // No last fetch, fetch again
                    fetchWatchlist(true);
                }
            });


        function fetchWatchlist(update) {
            App.Database.setting('get', {
                    key: 'watchlist'
                })
                .then(function (doc) {
                    if (doc && !update) {
                        // Returning cached watchlist
                        deferred.resolve(doc || []);
                    } else {
                        win.info('Watchlist - Fetching new watchlist');
                        App.Trakt.calendars.myShows(moment().subtract(31, 'days').format('YYYY-MM-DD'), 30)
                            .then(function (data) {
                                App.Database.setting('set', {
                                        key: 'watchlist',
                                        value: data
                                    })
                                    .then(function () {
                                        App.Database.setting('set', {
                                            key: 'watchlist-fetched',
                                            value: now.unix()
                                        });
                                    })
                                    .then(function () {
                                        deferred.resolve(data || []);
                                    });
                            })
                            .catch(function (error) {
                                deferred.reject(error);
                            });
                    }
                });
        }

        return deferred.promise;
    };

    var filterShows = function (items) {
        var filtered = [];
        var deferred = Q.defer();

        items.forEach(function (show) {
            var deferred = Q.defer();
            App.Database.show('get', show.show_id)
                .then(function (data) {
                    if (data != null) {
                        var value = {
                            tvdb_id: data.tvdb_id,
                            imdb_id: data.imdb_id,
                            season: show.season,
                            episode: show.episode
                        };
                        App.Database.watched('check', 'show', value)
                            .then(function (watched) {
                                if (!watched) {
                                    deferred.resolve(show.show_id);
                                } else {
                                    deferred.resolve(null);
                                }
                            });
                    } else {
                        //If not found, then get the details from Eztv and add it to the DB
                        data = Eztv.detail(show.show_id, show, false)
                            .then(function (data) {
                                if (data) {
                                    var value = {
                                        tvdb_id: data.tvdb_id,
                                        imdb_id: data.imdb_id,
                                        season: show.season,
                                        episode: show.episode
                                    };
                                    App.Database.watched('check', 'show', value)
                                        .then(function (watched) {
                                            if (!watched) {
                                                deferred.resolve(show.show_id);
                                            } else {
                                                deferred.resolve(null);
                                            }
                                        });
                                } else {
                                    deferred.resolve(null);
                                }
                            })
                            .catch(function (error) {
                                console.log(error);
                                deferred.resolve(null);
                            });
                    }
                });

            filtered.push(deferred.promise);
        });

        return Q.all(filtered);
    };

    var formatForPopcorn = function (list) {

        var showList = [];

        var items = [];
        list = list.filter(function (n) {
            return n !== undefined;
        });
        $.each(list, function (i, el) {
            if ($.inArray(el, items) === -1) {
                items.push(el);
            }
        });

        items.forEach(function (show) {
            var deferred = Q.defer();
            //Try to find it on the shows database and attach the next_episode info

            App.Database.show('get', show)
                .then(function (data) {
                    if (data != null) {
                        data.type = 'show';
                        data.image = data.images.poster;
                        data.imdb = data.imdb_id;
                        data.next_episode = show.next_episode;
                        // Fallback for old bookmarks without provider in database
                        if (typeof (data.provider) === 'undefined') {
                            data.provider = 'Eztv';
                        }
                        deferred.resolve(data);
                    } else {
                        //If not found, then get the details from Eztv and add it to the DB
                        data = Eztv.detail(show, show, false)
                            .then(function (data) {
                                if (data) {
                                    data.provider = 'Eztv';
                                    data.type = 'show';
                                    data.next_episode = show.next_episode;

                                    App.Database.show('add', data)
                                        .then(function (idata) {
                                            deferred.resolve(data);
                                        })
                                        .catch(function (err) {
                                            deferred.resolve(null);
                                        });
                                } else {
                                    deferred.resolve(null);
                                }
                            })
                            .catch(function (error) {
                                deferred.resolve(null);
                            });
                    }
                });
            showList.push(deferred.promise);
        });

        return Q.all(showList);
    };

    Watchlist.prototype.extractIds = function (items) {
        return _.pluck(items, 'imdb_id');
    };

    Watchlist.prototype.fetch = function (filters) {
        return queryTorrents(filters)
            .then(filterShows)
            .then(formatForPopcorn)
            .then(function (shows) {
                return {
                    results: _.filter(shows, Boolean),
                    hasMore: false
                };
            });
    };

    Watchlist.prototype.detail = function (torrent_id, old_data, callback) {
        return Eztv.detail(torrent_id, old_data, callback);
    };

    Watchlist.prototype.fetchWatchlist = function () {
        var now = moment();
        var deferred = Q.defer();

        win.info('Watchlist - Fetching new watchlist');
        App.Trakt.calendars.myShows(moment().subtract(31, 'days').format('YYYY-MM-DD'), 30)
            .then(function (data) {
                App.db.writeSetting({
                        key: 'watchlist',
                        value: data
                    })
                    .then(function () {
                        App.db.writeSetting({
                            key: 'watchlist-fetched',
                            value: now.unix()
                        });
                    })
                    .then(function () {
                        deferred.resolve(data || []);
                    });
            })
            .catch(function (error) {
                deferred.reject(error);
            });

        return deferred.promise;
    };

    App.Providers.Watchlist = Watchlist;

})(window.App);
