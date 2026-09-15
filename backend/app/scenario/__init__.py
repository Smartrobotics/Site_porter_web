"""
Генератор сценариев робота: план рейса → фрагменты JSON в общем каталоге.

Раньше лежал в репозитории робота (`Taisei_takuhai_system/tools/scenario_gen`).
Переехал сюда, потому что вызывает его сервер: он собирает рейс, пишет
фрагменты и отдаёт их имена мосту. ROS этому коду не нужен — только
стандартная библиотека.

`floors.json` — конфигурация объекта: номера карт и маршрутов.
`path_no` замеряются на месте; менять их будет тот, кто в Яшио.

Модули внутри импортируют друг друга плоско (`from gen_scenario import ...`),
потому что запускаются и как скрипты:

    python3 backend/app/scenario/gen_chain.py deliver --pickup 2:1:4 --dropoff 1:3
    python3 backend/app/scenario/selftest.py

Чтобы это работало и при импорте из сервера, каталог добавляется в sys.path.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gen_scenario import (  # noqa: E402
    SCENARIO_DIR,
    fragment_name,
    generate_chain,
    generate_fragment,
    home_floor,
    load_floors,
    plan_collect,
    plan_deliver,
    plan_deliver_collect,
    plan_go_home,
    render_fragment,
)

__all__ = [
    'SCENARIO_DIR',
    'fragment_name',
    'generate_chain',
    'generate_fragment',
    'home_floor',
    'load_floors',
    'plan_collect',
    'plan_deliver',
    'plan_deliver_collect',
    'plan_go_home',
    'render_fragment',
]
