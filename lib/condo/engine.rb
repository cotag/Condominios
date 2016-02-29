require 'rails'

module Condo
    class Engine < ::Rails::Engine


        # Define the base configuration options
        #
        #config.before_initialize do |app|                        # Rails.configuration
        #    app.config.condo = ActiveSupport::OrderedOptions.new
        #    app.config.condo.providers = ActiveSupport::OrderedOptions.new
        #end


        config.autoload_paths << File.expand_path("../../../lib", __FILE__)


        # Set the proper error types for Rails and add assets for compilation
        initializer "condo initializer" do |app|
            config.after_initialize do
                responses = {
                    "Condo::Errors::MissingFurniture" => :not_found,
                    "Condo::Errors::LostTheKeys" => :forbidden,
                    "Condo::Errors::NotYourPlace" => :unauthorized
                }
                if rescue_responses = config.action_dispatch.rescue_responses            # Rails 3.2+
                    rescue_responses.update(responses)
                else
                    ActionDispatch::ShowExceptions.rescue_responses.update(responses)    # Rails 3.0/3.1
                end
            end
        end
    end
end
