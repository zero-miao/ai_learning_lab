import signal
from threading import Event

from django.core.management.base import BaseCommand

from api.scheduler import start_scheduler


class Command(BaseCommand):
    help = "运行持久化 AI 任务 worker。"

    def handle(self, *args, **options):
        stopped = Event()

        def stop_worker(signum, frame):
            stopped.set()

        signal.signal(signal.SIGINT, stop_worker)
        signal.signal(signal.SIGTERM, stop_worker)
        scheduler = start_scheduler()
        self.stdout.write(self.style.SUCCESS("AI task worker started."))
        stopped.wait()
        scheduler.shutdown(wait=False)
