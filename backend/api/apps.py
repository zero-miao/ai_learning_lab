import os
import sys

from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "api"

    def ready(self):
        if "runserver" not in sys.argv or os.environ.get("RUN_MAIN") != "true":
            return
        from .scheduler import start_scheduler

        start_scheduler()
