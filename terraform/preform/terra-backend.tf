terraform {
  backend "local" {
    path = "~/.terraform/k2o.tfstate"
  }
}

module "params" {
  source     = "../params"
}

locals {
  project_id = module.params.project_id
  region     = module.params.region
}

resource "google_project_service" "storage_api" {
  service             = "storage.googleapis.com"
  disable_on_destroy  = true
  project             = local.project_id
}

resource "google_storage_bucket" "tf_backend" {
  name = "${local.project_id}-tf-backend"
  location      = local.region
  force_destroy = true
  uniform_bucket_level_access = true
  project = local.project_id
}

output "tf_backend_bucket_name" {
  value = google_storage_bucket.tf_backend.name
}
