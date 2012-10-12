/**
*	CoTag Condo
*	Direct to cloud resumable uploads
*	
*   Copyright (c) 2012 CoTag Media.
*	
*	@author 	Stephen von Takach <steve@cotag.me>
* 	@copyright  2012 cotag.me
* 
* 	
* 	References:
* 		* https://github.com/umdjs/umd
* 		* https://github.com/addyosmani/jquery-plugin-patterns
*		* http://ie.microsoft.com/testdrive/ieblog/2011/oct/PointerDraw.js.source.html (detect click, touch etc on all platforms)
*		* http://docs.angularjs.org/guide/directive
*		* http://stackoverflow.com/questions/3758606/how-to-convert-byte-size-into-human-readable-format-in-java/3758880
*
**/

(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['jquery', 'condo_uploader'], factory);
	} else {
		// Browser globals
		factory(jQuery, window.CondoUploader);
	}
}(function ($, uploads, undefined) {
	'use strict';
	
	
	var safeApply = function(scope, fn) {
		var phase = scope.$root.$$phase;
		if(phase == '$apply' || phase == '$digest') {
			fn();
		} else {
			scope.$apply(fn);
		}
	};
	
	
	//
	// Allow for both mobile and desktop events or both
	//	Overkill?
	//
	uploads.directive('coTap', function() {
		
		
		//
		// Opera doesn't have Object.keys so we use this wrapper
		//
		var NumberOfKeys = function(theObject) {
			if (Object.keys)
				return Object.keys(theObject).length;
			
			var n = 0;
			for (var key in theObject)
				++n;
			
			return n;
		};
		
		return function(scope, element, attrs) {
			var tracker = {},
			
			// common event handler for the mouse/pointer/touch models and their down/start, move, up/end, and cancel events
			DoEvent = function(event) {
				
				//
				// Optimise rejecting clicks (iOS) that are most likely triggered by a touch
				//
				if (event.originalEvent.type == "click" && NumberOfKeys(tracker) == 0)
					return;
				
				var theEvtObj = event.originalEvent,
					pointerList = theEvtObj.changedTouches ? theEvtObj.changedTouches : [theEvtObj];
				for (var i = 0; i < pointerList.length; ++i) {
					var pointerObj = pointerList[i],
						pointerId = (typeof pointerObj.identifier != 'undefined') ? pointerObj.identifier : (typeof pointerObj.pointerId != 'undefined') ? pointerObj.pointerId : 1;
					 
					if (theEvtObj.type.match(/(start|down)$/i)) {
						// clause for processing MSPointerDown, touchstart, and mousedown
						
						//
						// Track the element the event started on and if we should execute the attached action
						//
						tracker[pointerId] = {element: this, execute: true};
						
						//
						// in the Microsoft pointer model, set the capture for this pointer
						// in the mouse model, set the capture or add a document-level event handlers if this is our first down point
						// nothing is required for the iOS touch model because capture is implied on touchstart
						//
						if (this.msSetPointerCapture)
							this.msSetPointerCapture(pointerId);
						
						
					} else if (theEvtObj.type.match(/move$/i)) {
						// clause handles MSPointerMove and touchmove
						
						if(tracker[pointerId])
							tracker[pointerId].execute = false;
						
						
					} else if (tracker[pointerId] && theEvtObj.type.match(/(up|end|cancel|click)$/i)) {
						// clause handles up/end/cancel/click
						var target = tracker[pointerId].element;
						 
						if (!theEvtObj.type.match(/cancel$/i) && tracker[pointerId].execute === true)
							safeApply(scope, attrs['coTap']);	// Apply the click, touch, point event
						
						delete tracker[pointerId];
						
						//
						// in the Microsoft pointer model, release the capture for this pointer
						// in the mouse model, release the capture or remove document-level event handlers if there are no down points
						// nothing is required for the iOS touch model because capture is implied on touchstart
						//
						if (target.msReleasePointerCapture)
							target.msReleasePointerCapture(pointerId);
					}
				}
			};
 
			if (window.navigator.msPointerEnabled) {
				// Microsoft pointer model
				element.on('MSPointerDown.condo MSPointerMove.condo MSPointerUp.condo MSPointerCancel.condo', DoEvent);
			} else {
				// iOS touch model & mouse model
				element.on('touchstart.condo touchmove.condo touchend.condo touchcancel.condo mousedown.condo click.condo', DoEvent);
			}
			
			
			//
			// Clean up any event handlers
			//
			scope.$on('$destroy', function() {
				element.off('.condo');
			});
			
			
		};
	});
	
	//
	// create a directive for attaching the input events
	//
	uploads.directive('coUploads', ['Condo.Broadcast', function(broadcast) {
		return function(scope, element, attrs) {				
			var options = {
				delegate: attrs['coDelegate'] || element,
				drop_targets: attrs['coTargets'] || element,
				hover_class: attrs['coHoverClass'] || 'drag-hover',
				pre_check: attrs['coAccepts'] || '/./i',
				size_limit: attrs['coLimit'] || 0
			};
			
			
			if(!!attrs['coEndpoint'])
				scope.endpoint = attrs['coEndpoint'];
				
				
			scope.options = options;
			
			
			//
			// Determine how to draw the element
			//
			if(document.implementation.hasFeature("org.w3c.svg", "1.0")) {
				element.addClass('supports-svg');
			} else {
				element.addClass('no-svg');
			}
				
				
			//
			// Detect file drops
			//
			options.drop_targets = $(options.drop_targets);
			options.delegate = $(options.delegate).on('drop.condo', options.drop_targets, function(event) {
				options.drop_targets.removeClass(options.hover_class);
				
				//
				// Prevent propagation early (so any errors don't cause unwanted behaviour)
				//
				event.preventDefault();
				event.stopPropagation();
				
				safeApply(scope, function() {
					scope.add(event.originalEvent.dataTransfer.files);
				});
			}).on('dragover.condo', options.drop_targets, function(event) {
				$(this).addClass(options.hover_class);
				
				return false;
			}).on('dragleave.condo', options.drop_targets, function(event) {
				$(this).removeClass(options.hover_class);
				
				return false;
			}).
			
			
			//
			// Detect manual file uploads
			//
			on('change.condo', ':file', function(event) {
				var self = $(this);
				safeApply(scope, function() {
					scope.add(self[0].files);
					self.parents('form')[0].reset();
				});
			});
			
			
			//
			// Clean up any event handlers
			//
			scope.$on('$destroy', function() {
				options.drop_targets.off('.condo');
				options.delegate.off('.condo');
				element.removeClass('supports-svg').removeClass('no-svg');
			});
			
			
			scope.$on('coFileAddFailed', function() {
				alert('Failed to add file: ' + broadcast.message.reason);
			});
			
			
			scope.humanReadableByteCount = function(bytes, si) {
				var unit = si ? 1000.0 : 1024.0;
				if (bytes < unit) return bytes + (si ? ' iB' : ' B');
				var exp = Math.floor(Math.log(bytes) / Math.log(unit)),
					pre = (si ? 'kMGTPE' : 'KMGTPE').charAt(exp-1) + (si ? 'iB' : 'B');
				return (bytes / Math.pow(unit, exp)).toFixed(1) + ' ' + pre;
			}
		}
	}]);
	
	
	//
	// The individual upload events
	//	Triggers the pause, resume, abort functions
	//
	uploads.directive('coUpload', function() {
		var PENDING = 0,
			STARTED = 1,
			PAUSED = 2,
			UPLOADING = 3,
			COMPLETED = 4,
			ABORTED = 5;
		
		return function(scope, element, attrs) {
			
			scope.size = scope.humanReadableByteCount(scope.upload.size, false);
			scope.progress = 0;
			scope.paused = true;
			
			scope.$watch('upload.state', function(newValue, oldValue) {
				switch(newValue) {
					case STARTED:
						scope.paused = false;
						scope.upload.message = 'starting...';
						break;
						
					case UPLOADING:
						element.find('div.bar').addClass('animate');
						scope.upload.message = undefined;
						scope.paused = false;
						break;
						
					case COMPLETED:
						scope.upload.message = 'complete';
						element.find('td.controls').replaceWith( '<td class="blank" />' );
						element.find('div.bar').removeClass('animate');
						
						scope.check_autostart();
						break;
						
					case PAUSED:
						element.find('div.bar').removeClass('animate');
						if (scope.upload.message === undefined)
							scope.upload.message = 'paused';
							
						scope.paused = true;
						// No need for break
				}
			});
			
			scope.$watch('upload.progress', function(newValue, oldValue) {
				scope.progress = newValue / scope.upload.size * 100;
			});
						
			
			scope.animate_remove = function() {
				scope.abort(scope.upload);
				
				element.fadeOut(800, function() {
					safeApply(scope, function() {
						scope.remove(scope.upload);
					});
				});
			};
			
		};
	});
	
}));