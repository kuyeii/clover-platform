# -- coding: utf-8 --
# @Time : 2024/5/27 9:34
# @Author : Yao Sicheng
from celery import Celery
from app import create_app

app = create_app(register_all=False)
def make_celery(app):
    celery = Celery(app.name,
                    broker=app.config['CELERY_BROKER_URL'],
                    backend=app.config['RESULT_BACKEND'])
    return celery
my_celery = make_celery(app)
