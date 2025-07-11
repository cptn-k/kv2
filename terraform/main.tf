terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "k2o-dev-tf-backend"
    prefix = "terraform/state"
  }
}

# Variables

module "params" {
  source     = "./params"
}

locals {
  project_id = module.params.project_id
  region     = module.params.region
}

data "google_project" "project" {}

# Providers

provider "google" {
  project = local.project_id
  region  = local.region
}

# API Enablement

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = true
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = true
}

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = true
}

resource "google_project_service" "firestore" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = true
}

# Added Gmail API enablement
resource "google_project_service" "gmail" {
  service             = "gmail.googleapis.com"
  disable_on_destroy  = true
}

resource "google_project_service" "people" {
  service             = "people.googleapis.com"
  disable_on_destroy  = true
}

resource "google_project_service" "calendar" {
  service             = "calendar-json.googleapis.com"
  disable_on_destroy  = true
}

resource "google_project_service" "scheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = true
}

resource "google_firestore_database" "default" {
  name        = "(default)"
  project     = local.project_id
  location_id = local.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.firestore]
}



resource "google_storage_bucket" "input-images" {
  name                        = "k2o-dev-input-images"
  location                    = local.region
  uniform_bucket_level_access = true
  force_destroy               = true
  public_access_prevention    = "inherited"
}


resource "google_storage_bucket_iam_member" "container_sa_bucket_access" {
  bucket = google_storage_bucket.input-images.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.container_sa.email}"
  depends_on = [
    google_storage_bucket.input-images,
    google_service_account.container_sa
  ]
}




# Service Accounts

resource "google_service_account" "container_sa" {
  account_id   = "kv2-backend-sa"
  display_name = "kv2-backend-sa"
}

# IAM Bindings

resource "google_project_iam_member" "container_sa_secret_access" {
  project = local.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.container_sa.email}"
}

resource "google_project_iam_member" "container_sa_firestore_access" {
  project = local.project_id
  role    = "roles/datastore.owner"
  member  = "serviceAccount:${google_service_account.container_sa.email}"
}

# Placeholder Cloud Run service
resource "google_cloud_run_service" "dummy" {
  name     = "kv2-backend-service"
  location = local.region

  template {
    spec {
      containers {
        image = "gcr.io/cloudrun/hello"
        resources {
          limits = {
            cpu    = "2"
            memory = "2Gi"
          }
        }
      }
      container_concurrency = 160
      timeout_seconds = 300
    }
    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale" = "1"
        "autoscaling.knative.dev/minScale" = "0"
        "run.googleapis.com/cpu-throttling" = "false"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [
    google_project_service.run
  ]

}

resource "google_cloud_scheduler_job" "call_backend_service" {
  name        = "call-backend-service"
  description = "Calls Cloud Run backend service every 15 minutes"
  schedule    = "*/15 * * * *"
  time_zone   = "UTC"

  http_target {
    uri         = "${google_cloud_run_service.dummy.status[0].url}/system/refresh"
    http_method = "GET"

    oidc_token {
      service_account_email = google_service_account.container_sa.email
    }
  }

  depends_on = [google_project_service.run, google_cloud_run_service.dummy, google_project_service.scheduler]
}