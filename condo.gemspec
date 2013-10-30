$:.push File.expand_path("../lib", __FILE__)

# Maintain your gem's version:
require "condo/version"

# Describe your gem and declare its dependencies:
Gem::Specification.new do |s|
  s.name        = "condo"
  s.version     = Condo::VERSION
  s.authors     = ["Stephen von Takach"]
  s.email       = ["steve@cotag.me"]
  s.homepage    = "http://cotag.me/"
  s.summary     = "Direct Cloud Storage Uploader"
  s.description = "Provides signed upload signatures to your users browsers so they can upload directly to cloud storage providers"

  s.files = Dir["{app,config,db,lib}/**/*"] + ["LGPL3-LICENSE", "Rakefile", "README.textile"]
  s.test_files = Dir["test/**/*"]

  s.add_dependency "rails", ">= 4.0.0"
  s.add_dependency "fog"
end
