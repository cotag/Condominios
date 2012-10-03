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
*
**/

(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define('condo_uploader', ['jquery'], factory);
	} else {
		// Browser globals
		factory(jQuery);
	}
}(function ($, undefined) {
	'use strict';
	
	
	//
	// Create a namespace for storing the various storage logic
	//
	if (!$.condo) {
		$.condo = {
			strategies: {}
		}
	}
	
	
	//
	// Defaults
	//
	var pluginName = 'condoUploader',
	defaults = {
		// api_endpoint					(url the api is located at)
		// new_file						(callback that allows for preventing a file upload or adding custom params)
		// drop_targets					(elements that will accept a file drop)
		// hover_class					(apply a class to the hover elements)
		input_elements: 'input[:file]',	// Input elements to listen to
		auto_start: true,				// Auto start uploads
		auto_clear: false,				// Auto clear completed uploads from the list
		halt_on_error: false,			// Stop processing further uploads when an error occurs
		upload_retry_limit: 3			// We won't consider an upload failure an error until this retry limit is reached
	};
	
	//
	// Plugin Constructor
	//
	function Uploader( element, options ) {
		this.element = $(element);
		this.options = $.extend({}, defaults, options);
		this._defaults = defaults;
		this.queue = [];
		
		this.init();
	}
	
	Uploader.prototype = {
		init: function() {
			var $this = this.element,
				self = this;
			
			//
			// Manage the queue
			//
			this.element.on('aborted.condo completed.condo', function(event, file, upload) {
				self.queue.splice(self.queue.indexOf(upload), 1);	// Remove the upload from the queue
			});
			
			this.element.on('started.condo', function(event, file, upload) {
				var index = self.queue.indexOf(upload);
				if(index == -1) {
					self.queue.push(upload);	// Remove the upload from the queue
				}
			});
			
			//
			// Detect file drops
			//
			if(!!this.options['drop_targets']) {
				this.element.on('drop.condo', this.options.drop_targets, function(event) {
					if(!!self.options['hover_class']) {
						$this.removeClass(self.options.hover_class);
					}
					
					//
					// Prevent propagation early (so any errors don't cause unwanted behaviour)
					//
					event.preventDefault();
					event.stopPropagation();
					self.add_files(event.originalEvent.dataTransfer.files);
				}).on('dragover.condo', this.options.drop_targets, function(event) {
					if(!!self.options['hover_class']) {
						$(this).addClass(self.options.hover_class);
					}
					
					return false;
				}).on('dragleave.condo', this.options.drop_targets, function(event) {
					if(!!self.options['hover_class']) {
						$(this).removeClass(self.options.hover_class);
					}
					
					return false;
				});
			}
			
			//
			// Detect manual file uploads
			//
			if(!!this.options['input_elements']) {
				this.element.on('change.condo', this.options.input_elements, function(event) {
					
					self.add_files($(this)[0].files);
					
				});
			}
		},
		
		//
		// For the current upload find the upload strategy we need to use
		//
		get_provider: function(file, params) {
			var $this = this;
			
			params = params || {};
			params['file_size'] = file.size;
			params['file_name'] = file.name;
			
			$.ajax({
				url: this.options.api_endpoint + '/new',
				data: {upload: params},
				dataType: 'json',
				success: function(data, textStatus, jqXHR) {
					if(!!$.condo.strategies[data.residence]) {
						var upload = new $.condo.strategies[data.residence]($this.element, $this.options, file, params);
						$this.queue.push(upload);
						$this.element.trigger('added', [file, upload]);
					} else {
						$this.element.trigger('error', [file, null, 'residence', data]);	// Could not find the client side strategy
					}
				},
				error: function(jqXHR, textStatus, errorThrown) {
					$this.element.trigger('error', [file, null, errorThrown, jQuery.parseJSON(jqXHR.responseText)]);
				}
			});
		},
		
		//
		// Add files to the queue
		//
		add_files: function(files) {
			var response = false;
			
			for (var i = 0, f; f = files[i]; i++) {
				if(!!this.options['new_file']) {			// Client side extension / file check
					response = this.options.new_file(f);
					if(!!response)
						this.get_provider(f, response);
				} else {
					this.get_provider(f);
				}
			}
		},
		
		pause_all: function() {
			for (var i = 0, f; f = this.queue[i]; i++) {
				f.pause();	// Pauses if active
			}
		},
		
		abort_all: function() {
			for (var i = 0, f; f = this.queue[i]; i++) {
				f.abort();
			}
		},
		
		start_all: function() {
			for (var i = 0, f; f = this.queue[i]; i++) {
				f.start();	// Starts if pending or paused
			}
		},
		
		destroy: function() {
			this.pause_all();
			this.element.off('.condo').removeData('plugin_' + pluginName);
		}
	};
	
	
	$.fn[pluginName] = function( options ) {
		
		//
		// The uploader attaches delegates to the matching elements
		//	Events are then fired from these to expose state
		//
		return this.each(function () {
			if (!$.data(this, 'plugin_' + pluginName)) {
				$.data(this, 'plugin_' + pluginName, new Uploader( this, options ));
			} else if (typeof options === 'string') {
				//
				// We do a function call
				//
				var plugin = $.data(this, 'plugin_' + pluginName);
				plugin[options].apply(plugin, Array.prototype.slice.call( arguments, 1 ));
			}
		});
	};
}));
