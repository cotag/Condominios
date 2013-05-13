/**
*	Core Messaging library
*	Provides the core wrapper for application wide messaging and signalling
*	
*   Copyright (c) 2013 CoTag Media.
*	
*	@author 	Stephen von Takach <steve@cotag.me>
* 	@copyright  2013 cotag.me
* 
* 	
* 	References:
*		* http://www.gridlinked.info/angularJS/modules/MessagingServices.js
* 		
*
**/

(function(angular, undefined) {
	'use strict';
	
	angular.module('Core').
		//
		//
		// Wrapper for jQuery Callbacks that provides a constructor for building
		//	application specific message channels
		//
		//	e.g.
		//	factory('MyApp.Channel', ['Channel', function(Channel) {
		//		return Channel.openChannel('once memory unique stopOnFalse');	// settings are optional
		//	}]);
		//
		//	then in a controller / directive somewhere:
		//	controller('MyApp.Cntrl', ['$scope', 'MyApp.Channel', function($scope, channel) {
		//		channel.subscribe(function(value) { $scope.update = value; });
		//	}
		//
		//
		factory('$channel', ['$rootScope', '$safeApply', function($rootScope, safeApply) {
			var getChannel = function(settings) {
				var callback = angular.element.Callbacks(settings);
				return {
					publish: function() {
						var args = arguments;		// Curry the arguments
						safeApply.do($rootScope, function() {
							callback.fire.apply(callback, args);
						});
					},
					subscribe: callback.add,
					unsubscribe: callback.remove,
					has: callback.has,
					empty: callback.empty
				};
			};
			
			return {
				openChannel: getChannel
			};
		}]).
	
	
		//
		//
		// Wrapper for jQuery Callbacks that provides a constructor for building
		//	application specific messaging factories
		//
		//	e.g.
		//	factory('MyApp.Messenger', ['Spectrum', function(Spectrum) {
		//		return Spectrum.newSpectrum('once memory unique stopOnFalse');	// settings are optional
		//	}]);
		//
		//	then in a controller / directive somewhere:
		//	controller('MyApp.Cntrl', ['$scope', 'MyApp.Messenger', function($scope, messages) {
		//		var channel = messages.openChannel('controllers');
		//		channel.subscribe(function(value) { $scope.update = value; });
		//	}
		//
		//
		factory('$spectrum', ['$channel', function(Channel) {
			
			var buildSpectrum = function(settings) {
				var channels = {},
				
					//
					// Creates or returns a reference to a channel in the spectrum
					//
					openChannel = function(name) {
						var channel = name && channels[name],
							callback;
							
						if (!channel) {
							channel = {
								access: Channel.openChannel(settings),
								count: 0
							};
							
							channels[name] = channel;
						}
						
						return channel;
					},	// end openChannel
					
					//
					// Deletes channels that are no longer in use
					//
					closeChannel = function(name) {
						delete channels[name];
						return 0;
					},
					
					channelList = function() {
						return Object.keys(channels);
					},
					
					subscribeTo = function(name, callback) {
						var channel = channels[name] || openChannel(name);
						if(!channel.access.has(callback)) {
							channel.access.subscribe(callback);
							channel.count += 1;
						}
						return channel.count;
					},
					
					subscribedTo = function(name) {
						return !channels[name] ? 0 : channels[name].count;
					},
					
					unsubscribeFrom = function(name, callback) {
						var channel = channels[name];
						
						if (!!channel) {
							if(callback === undefined) {
								return closeChannel(name);
							} else if (channel.access.has(callback)) {
								if (channel.count > 1) {
									channel.access.unsubscribe(callback);
									channel.count -= 1;
								} else {
									return closeChannel(name);
								}
							}
							return channel.count;
						}
						return 0;
					},
					
					publishTo = function(name) {
						var channel = channels[name];
						
						if (!!channel) {
							channel.access.publish.apply(channel.access, Array.prototype.slice.call( arguments, 1 ));
						} else if (settings.match(/memory/i)) {
							channel = openChannel(name);
							channel.access.publish.apply(channel.access, Array.prototype.slice.call( arguments, 1 ));
						}
					};
				
				return {
					channelList: channelList,
					subscribe: subscribeTo,
					subscriptions: subscribedTo,
					unsubscribe: unsubscribeFrom,
					publish: publishTo
				};
			};	// End buildSpectrum
			
			return {
				newSpectrum: buildSpectrum
			};
		}]);


})(angular);
