require 'singleton'


module Condo

    class Configuration
        include Singleton


        @@callbacks = {
            #
            #:resident_id        # Must be defined by the including class
            #
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
                filename = filename.encode('UTF-8', 'binary', invalid: :replace, undef: :replace, replace: '')
                filename.gsub!(/^.*(\\|\/)/, '')    # get only the filename (just in case)
                filename.gsub!(/[^\w\.\-]/, '_')    # replace all non alphanumeric or periods with underscore
                filename
            },
            :sanitize_filepath => proc { |filepath|
                filepath = filepath.encode('UTF-8', 'binary', invalid: :replace, undef: :replace, replace: '')
                filepath.gsub!(/[^\w\.\-\/]/, '_')        # replace all non alphanumeric or periods with underscore
                filepath
            },
            :select_residence => proc { |config, resident_id, upload|
                # Where config === ::Condo::Configuration
                # and resident_id is the result of the resident_id callback
                # upload will only be present if it already exists
                config.residencies[0]
            }
            #:upload_complete    # Must be defined by the including class
            #:destroy_upload     # the actual delete should be done by the application
        }

        def self.callbacks
            @@callbacks
        end

        # Allows you to override default callback behaviour
        def self.set_callback(name, callback = nil, &block)
            callback ||= block
            if callback.respond_to?(:call)
                @@callbacks[name.to_sym] = callback
            else
                raise ArgumentError, 'No callback provided'
            end
        end

        # Allows for predefined storage providers (maybe you only use Amazon?)
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

        def self.get_residence(name, options = {})
            name = name.to_sym
            namespace = (options[:namespace] || :global).to_sym
            location = (options[:location] || :default).to_sym

            if @@locations && @@locations[namespace] && @@locations[namespace][name] && @@locations[namespace][name][location]
                return @@locations[namespace][name][location]
            end

            nil
        end

        def self.dynamic_residence(name, options = {})
            return "Condo::Strata::#{name.to_s.camelize}".constantize.new(options)
        end

        def self.residencies
            @@residencies
        end
    end
end
