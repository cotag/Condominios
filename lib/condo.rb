# encoding: utf-8

require 'unf'
require 'fog/aws'
require 'fog/google'
require 'fog/openstack'
require 'azure'
require 'condo/engine'
require 'condo/errors'
require 'condo/configuration'


module Condo
    module Condo::Strata
        autoload :AmazonS3,           File.expand_path('../condo/strata/amazon_s3', __FILE__)
        autoload :GoogleCloudStorage, File.expand_path('../condo/strata/google_cloud_storage', __FILE__)
        autoload :MicrosoftAzure,     File.expand_path('../condo/strata/microsoft_azure', __FILE__)
        autoload :OpenStackSwift,     File.expand_path('../condo/strata/open_stack_swift', __FILE__)
    end


    def self.included(base)
        base.class_eval do


            def new
                # Returns the provider that will be used for this file upload
                resident = current_resident

                # Ensure parameters are correct
                params.require(:file_size)
                params.require(:file_name)
                permitted = params.permit(:file_size, :file_name, :file_path)
                @upload = {
                    file_size: permitted[:file_size].to_i,
                    file_name: @@callbacks[:sanitize_filename].call(permitted[:file_name])
                }
                @upload[:file_path] = @@callbacks[:sanitize_filepath].call(permitted[:file_path]) if permitted[:file_path]

                valid, errors = instance_exec(@upload, &@@callbacks[:pre_validation])       # Ensure the upload request is valid before uploading

                if valid
                    residence = current_residence

                    render json: {residence: residence.name}
                elsif errors.is_a? Hash
                    render json: errors, status: :not_acceptable
                else
                    head :not_acceptable
                end
            end

            def create
                # Check for existing upload or create a new one
                # => mutually exclusive so can send back either the parts signature from show or a bucket creation signature and the upload_id
                resident = current_resident

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

                # Check for existing uploads
                upload = condo_backend.check_exists(@upload)

                if upload.present?
                    residence = current_residence(upload)

                    # Return the parts or direct upload sig
                    request = nil
                    if upload.resumable_id.present? && upload.resumable
                        request = residence.get_parts({
                            bucket_name: upload.bucket_name,
                            object_key: upload.object_key,
                            object_options: upload.object_options.symbolize_keys,
                            file_size: upload.file_size,
                            resumable_id: upload.resumable_id
                        })

                        request[:part_list] = upload.part_list || []
                        request[:part_data] = upload.part_data if upload.part_data
                    else
                        request = residence.new_upload({
                            bucket_name: upload.bucket_name,
                            object_key: upload.object_key,
                            object_options: upload.object_options.symbolize_keys,
                            file_size: upload.file_size,
                            file_id: upload.file_id
                        })
                    end

                    render json: request.merge!({
                        upload_id: upload.id,
                        residence: residence.name
                    })
                else
                    # Create a new upload
                    valid, errors = instance_exec(@upload, &@@callbacks[:pre_validation])               # Ensure the upload request is valid before uploading

                    if valid
                        residence = current_residence

                        # Build the request
                        @upload.merge!({
                            bucket_name:    (instance_eval &@@callbacks[:bucket_name]),             # Allow the application to define a custom bucket name
                            object_key:     instance_exec(@upload, &@@callbacks[:object_key]),      # The object key should also be generated by the application
                            object_options: instance_exec(@upload, &@@callbacks[:object_options])   # Do we want to mess with any of the options?
                        })
                        request = residence.new_upload(@upload)
                        resumable = request[:type] == :chunked_upload

                        # Save a reference to this upload in the database
                        # => This should throw an error on failure
                        upload = condo_backend.add_entry(@upload.merge!({provider_name: residence.name, provider_location: residence.location, resumable: resumable}))
                        render json: request.merge!(upload_id: upload.id, residence: residence.name)

                    elsif errors.is_a? Hash
                        render json: errors, status: :not_acceptable
                    else
                        head :not_acceptable
                    end
                end
            end

            # Authorization check all of these
            def edit
                # Get the signature for parts + final commit
                upload = current_upload

                params.require(:part)
                safe_params = params.permit(:part, :file_id)

                if upload.resumable_id.present? && upload.resumable
                    residence = current_residence(upload)

                    request = residence.set_part({
                        bucket_name: upload.bucket_name,
                        object_key: upload.object_key,
                        object_options: upload.object_options.symbolize_keys,
                        resumable_id: upload.resumable_id,
                        # part may be called 'finish' for commit signature
                        part: safe_params[:part],
                        file_size: upload.file_size,
                        file_id: safe_params[:file_id]
                    })

                    render json: request.merge!(upload_id: upload.id)
                else
                    head :not_acceptable
                end
            end


            def update
                # Provide the upload id after creating a resumable upload (may not be completed)
                # => We then provide the first part signature
                #
                # OR
                #
                # Complete an upload
                upload = current_upload

                safe = params.permit(:resumable_id, {part_list: []}, {part_data: [
                    :md5,
                    :size_bytes,
                    :path,
                    :part
                ]})
                part_list = safe[:part_list]
                resumable_id = safe[:resumable_id]

                if resumable_id || part_list
                    if upload.resumable
                        if part_list
                            upload.part_list = part_list || []

                            # We incrementally update this as it might otherwise contain
                            # sum(1 -> 10,000) parts over the time of the upload
                            # (as is the case with the largest file amazon supports)
                            if safe[:part_data]
                                upload.part_data ||= {}
                                safe[:part_data].each do |part|
                                    upload.part_data[part[:part]] = part
                                end
                            end
                        end

                        upload.resumable_id = resumable_id if resumable_id
                        upload.save!

                        if params[:part_update]
                            head :ok
                        else
                            @current_upload = upload

                            # Render is called from edit
                            edit
                        end
                    else
                        head :not_acceptable
                    end

                else # We are completeing the upload
                    response = instance_exec upload, &@@callbacks[:upload_complete]
                    if response
                        head :ok
                    else
                        head :not_acceptable
                    end
                end
            end

            def destroy
                # Delete the file from the cloud system - the client is not responsible for this
                response = instance_exec current_upload, &@@callbacks[:destroy_upload]
                if response
                    head :ok
                else
                    head :not_acceptable
                end
            end


            protected


            def current_residence(upload = nil)
                @current_residence ||= instance_exec(condo_config, current_resident, upload, &@@callbacks[:select_residence])
            end

            def current_upload
                return @current_upload if @current_upload

                safe_params = params.permit(:upload_id, :id)
                # current_residence.name && current_residence.location && resident.id.exists?
                @current_upload = condo_backend.check_exists({user_id: current_resident, upload_id: (safe_params[:upload_id] || safe_params[:id])}).tap do |object|
                    raise Condo::Errors::NotYourPlace unless object.present?
                end
            end

            def current_resident
                # instance_exec for params
                @current_resident ||= (instance_eval &@@callbacks[:resident_id]).tap do |object|
                    raise Condo::Errors::LostTheKeys unless object.present?
                end
            end

            def condo_backend
                ::Condo::Store
            end

            def condo_config
                ::Condo::Configuration
            end


            # Defines the default callbacks
            (@@callbacks ||= {}).merge! Condo::Configuration.callbacks

            def self.condo_callback(name, callback = nil, &block)
                callback ||= block
                if callback.respond_to?(:call)
                    @@callbacks[name.to_sym] = callback
                else
                    raise ArgumentError, 'No callback provided'
                end
            end
        end
    end
end
