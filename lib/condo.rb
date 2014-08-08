require 'condo/engine'
require 'condo/errors'
require 'condo/configuration'


module Condo
    def self.included(base)
        base.class_eval do
            
            
            def new
                #
                # Returns the provider that will be used for this file upload
                resident = current_resident

                #
                # Ensure parameters are correct
                params.require(:file_size)
                params.require(:file_name)
                permitted = params.permit(:file_size, :file_name, :file_path)
                @upload = {
                    file_size: permitted[:file_size].to_i,
                    file_name: @@callbacks[:sanitize_filename].call(permitted[:file_name])
                }
                @upload[:file_path] = @@callbacks[:sanitize_filepath].call(permitted[:file_path]) if permitted[:file_path]
                
                valid, errors = instance_exec(@upload, @@callbacks[:pre_validation])       # Ensure the upload request is valid before uploading
                
                if !!valid
                    set_residence(nil, {:resident => resident, :params => @upload}) if condo_config.dynamic_provider_present?(@@namespace)
                    residence = current_residence
                    
                    render :json => {:residence => residence.name}
                    
                elsif errors.is_a? Hash
                    render :json => errors, :status => :not_acceptable
                else
                    render :nothing => true, :status => :not_acceptable
                end
            end
            
            def create
                #
                # Check for existing upload or create a new one
                # => mutually exclusive so can send back either the parts signature from show or a bucket creation signature and the upload_id
                #
                resident = current_resident
                
                #
                # Ensure parameters are correct
                params.require(:file_size)
                params.require(:file_name)
                params.require(:file_id)
                permitted = params.permit(:file_size, :file_name, :file_path, :file_id)
                @upload = {
                    file_size: permitted[:file_size].to_i,
                    file_name: @@callbacks[:sanitize_filename].call(permitted[:file_name]),
                    file_id: permitted[:file_id],
                    user_id: resident
                }
                @upload[:file_path] = @@callbacks[:sanitize_filepath].call(permitted[:file_path]) if permitted[:file_path]
                
                #
                # Check for existing uploads
                upload = condo_backend.check_exists(@upload)
                
                if upload.present?
                    residence = set_residence(upload.provider_name, {
                        :location => upload.provider_location,
                        :upload => upload
                    })
                    
                    #
                    # Return the parts or direct upload sig
                    #
                    request = nil
                    if upload.resumable_id.present? && upload.resumable
                        request = residence.get_parts({
                            :bucket_name => upload.bucket_name,
                            :object_key => upload.object_key,
                            :object_options => upload.object_options,
                            :file_size => upload.file_size,
                            :resumable_id => upload.resumable_id
                        })
                    else
                        request = residence.new_upload({
                            :bucket_name => upload.bucket_name,
                            :object_key => upload.object_key,
                            :object_options => upload.object_options,
                            :file_size => upload.file_size,
                            :file_id => upload.file_id
                        })
                    end
                    
                    render :json => request.merge(:upload_id => upload.id, :residence => residence.name)
                else
                    #
                    # Create a new upload
                    #
                    valid, errors = instance_exec(@upload, &@@callbacks[:pre_validation])               # Ensure the upload request is valid before uploading
                    
                    
                    if valid
                        set_residence(nil, {:resident => resident, :params => @upload}) if condo_config.dynamic_provider_present?(@@namespace)
                        residence = current_residence
                        
                        #
                        # Build the request
                        #
                        @upload.merge!({
                            bucket_name:    (instance_eval &@@callbacks[:bucket_name]),     # Allow the application to define a custom bucket name
                            object_key:     @@callbacks[:object_key].call(@upload),          # The object key should also be generated by the application
                            object_options: @@callbacks[:object_options].call(@upload)       # Do we want to mess with any of the options?
                        })
                        request = residence.new_upload(@upload)
                        resumable = request[:type] == :chunked_upload
                        
                        #
                        # Save a reference to this upload in the database
                        # => This should throw an error on failure
                        #
                        upload = condo_backend.add_entry(@upload.merge!({:provider_name => residence.name, :provider_location => residence.location, :resumable => resumable}))
                        render :json => request.merge!(:upload_id => upload.id, :residence => residence.name)
                        
                    elsif errors.is_a? Hash
                        render :json => errors, :status => :not_acceptable
                    else
                        render :nothing => true, :status => :not_acceptable
                    end
                end
            end
            
            
            #
            # Authorization check all of these
            #
            def edit
                #
                # Get the signature for parts + final commit
                #
                upload = current_upload
                params.require(:part)
                safe_params = params.permit(:part, :file_id)
                
                if upload.resumable_id.present? && upload.resumable
                    residence = set_residence(upload.provider_name, {:location => upload.provider_location, :upload => upload})
                    
                    request = residence.set_part({
                        :bucket_name => upload.bucket_name,
                        :object_key => upload.object_key,
                        :object_options => upload.object_options,
                        :resumable_id => upload.resumable_id,
                        :part => safe_params[:part],                        # part may be called 'finish' for commit signature
                        :file_size => upload.file_size,
                        :file_id => safe_params[:file_id]
                    })
                    
                    render :json => request.merge!(:upload_id => upload.id)
                else
                    render :nothing => true, :status => :not_acceptable
                end
            end
            
            
            def update
                #
                # Provide the upload id after creating a resumable upload (may not be completed)
                # => We then provide the first part signature
                #
                # OR
                #
                # Complete an upload
                #
                if params[:resumable_id]
                    upload = current_upload
                    if upload.resumable
                        @current_upload = upload.update_entry :resumable_id => params.permit(:resumable_id)[:resumable_id]
                        edit
                    else
                        render :nothing => true, :status => :not_acceptable
                    end
                else
                    response = instance_exec current_upload, &@@callbacks[:upload_complete]
                    if response
                        render :nothing => true
                    else
                        render :nothing => true, :status => :not_acceptable
                    end
                end
            end
            
            
            def destroy
                #
                # Delete the file from the cloud system - the client is not responsible for this
                #
                response = instance_exec current_upload, &@@callbacks[:destroy_upload]
                if response
                    render :nothing => true
                else
                    render :nothing => true, :status => :not_acceptable
                end
            end
            
            
            protected
            
            
            #
            # A before filter can be used to select the cloud provider for the current user
            #     Otherwise the dynamic residence can be used when users are define their own storage locations
            #
            def set_residence(name, options = {})
                options[:namespace] = @@namespace
                @current_residence = condo_config.set_residence(name, options)
            end
            
            def current_residence
                @current_residence ||= condo_config.residencies[0]
            end
            
            def current_upload
                return @current_upload if @current_upload

                safe_params = params.permit(:upload_id, :id)
                @current_upload = condo_backend.check_exists({:user_id => current_resident, :upload_id => (safe_params[:upload_id] || safe_params[:id])}).tap do |object|    #current_residence.name && current_residence.location && resident.id.exists?
                    raise Condo::Errors::NotYourPlace unless object.present?
                end
            end
            
            def current_resident
                @current_resident ||= (instance_eval &@@callbacks[:resident_id]).tap do |object|    # instance_exec for params
                    raise Condo::Errors::LostTheKeys unless object.present?
                end
            end
            
            def condo_backend
                Condo::Store
            end
            
            def condo_config
                Condo::Configuration.instance
            end
            
        
            #
            # Defines the default callbacks
            #
            (@@callbacks ||= {}).merge! Condo::Configuration.callbacks
            @@namespace ||= :global
            
            
            def self.condo_callback(name, callback = nil, &block)
                callback ||= block
                if callback.respond_to?(:call)
                    @@callbacks[name.to_sym] = callback
                else
                    raise ArgumentError, 'No callback provided'
                end
            end
            
            
            def self.condo_namespace(name)
                @@namespace = name.to_sym
            end
        
        end
    end
end
