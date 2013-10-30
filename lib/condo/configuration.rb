require 'singleton'

module Condo
    
    class Configuration
        include Singleton
        
        @@callbacks = {
            #:resident_id        # Must be defined by the including class
            :bucket_name => proc {"#{Rails.application.class.parent_name}#{instance_eval @@callbacks[:resident_id]}"},
            :object_key => proc { |upload|
                if upload[:file_path]
                    upload[:file_path] + upload[:file_name]
                else
                    upload[:file_name]
                end
            },
            :object_options => proc { |upload|
                {:permissions => :private}
            },
            :pre_validation => proc { |upload|
                true
            },    # To respond with errors use: lambda {return false, {:errors => {:param_name => 'wtf are you doing?'}}}
            :sanitize_filename => proc { |filename|
                filename.gsub!(/^.*(\\|\/)/, '')    # get only the filename (just in case)
                filename.gsub!(/[^\w\.\-]/, '_')     # replace all non alphanumeric or periods with underscore
                filename
            },
            :sanitize_filepath => proc { |filepath|
                filepath.gsub!(/[^\w\.\-\/]/, '_')        # replace all non alphanumeric or periods with underscore
                filepath
            }
            #:upload_complete    # Must be defined by the including class
            #:destroy_upload    # the actual delete should be done by the application
            #:dynamic_residence    # If the data stores are dynamically stored by the application
        }
        
        @@dynamics = {}
        
        def self.callbacks
            @@callbacks
        end
        
        def self.set_callback(name, callback = nil, &block)
            callback ||= block
            if callback.respond_to?(:call)
                @@callbacks[name.to_sym] = callback
            else
                raise ArgumentError, 'No callback provided'
            end
        end
        
        
        #
        # Provides a callback whenever attempting to select a provider for the current request
        # => Allows multiple providers for different users / controllers or dynamic providers
        #
        def self.set_dynamic_provider(namespace, callback = nil, &block)
            callback ||= block
            if callback.respond_to?(:call)
                @@callbacks[name.to_sym] = callback
            else
                raise ArgumentError, 'No callback provided'
            end
        end
        
        def dynamic_provider_present?(namespace)
            return false if @@dynamics.nil? || @@dynamics[namespace.to_sym].nil?
            true
        end
        
        
        #
        # Allows for predefined storage providers (maybe you only use Amazon?)
        #
        def self.add_residence(name, options = {})
            @@residencies ||= []
            @@residencies << ("Condo::Strata::#{name.to_s.camelize}".constantize.new(options)).tap do |res|
                name = name.to_sym
                namespace = (options[:namespace] || :global).to_sym
                
                @@locations ||= {}
                @@locations[namespace] ||= {}
                @@locations[namespace][name] ||= {}
                
                if options[:location].present?
                    @@locations[namespace][name][options[:location].to_sym] = res
                else
                    @@locations[namespace][name][:default] = res
                    @@locations[namespace][name][res.location.to_sym] = res
                end
            end
        end
        
        
        def residencies
            @@residencies
        end
        
        
        #
        # Storage provider selection routine
        # => pass in :dynamic => true with :name and connection options to create a new instance
        #
        def set_residence(name, options)
            if options[:namespace].present? && dynamic_provider_present?(options[:namespace])
                if options[:upload].present?
                    upload = options[:upload]
                    params = {
                        :user_id => upload.user_id,
                        :file_name => upload.file_name,
                        :file_size => upload.file_size,
                        :provider_name => upload.provider_name,
                        :provider_location => upload.provider_location,
                        :provider_namespace => upload.provider_namespace
                    }
                    return instance_exec params, &@@dynamics[upload.provider_namespace]
                else
                    params = {
                        :user_id => options[:resident],
                        :file_name => options[:params][:file_name],
                        :file_size => options[:params][:file_size],
                        :provider_namespace => options[:namespace]
                    }
                    return instance_exec params, &@@dynamics[options[:namespace]]
                end
            else
                if options[:dynamic]
                    return "Condo::Strata::#{name.to_s.camelize}".constantize.new(options)
                else
                    return options[:location].present? ? @@locations[options[:namespace]][name.to_sym][options[:location].to_sym] : @@locations[options[:namespace]][name.to_sym][:default]
                end
            end
        end
        
    end
    
end