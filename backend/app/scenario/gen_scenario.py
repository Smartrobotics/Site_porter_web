#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SitePorter — генерация сценария для робота из шаблона (путь 0).

Робот принимает только ИМЯ сценария (`/scenario_name`, std_msgs/String) и читает
`<scenario_dir>/<имя>.json`. Параметров он не принимает. Поэтому сервер, который
стоит на том же роботе, подставляет значения сам, кладёт готовый файл в каталог
сценариев и публикует его имя. Правок в C++ не требуется.

Движок читает файл заново на каждый запуск (кэша нет), поэтому свежесозданный
сценарий подхватывается сразу.

Шаблон `template_roundtrip.json` получен из проверенного `press_scenario_4.json`
заменой шести значений на плейсхолдеры. Остальные шаги не тронуты.
Четыре из них — те, которыми `press_scenario_4` отличается от
`press_scenario_5`. Ещё два (`pickup_path_no`, `return_dropoff_path_no`) —
подъезды к местам на 2F: в обоих готовых сценариях там `path_no=1`, потому что
рейс возвращает платформу на то же место, откуда забрал.

Использование как CLI:
    python3 gen_scenario.py --pickup-marker 4 --pickup-path 1 --dropoff-path 3 \
                            --return-pickup-path 4 --return-marker 5 \
                            --return-dropoff-path 1

Использование из сервера:
    from gen_scenario import generate
    name = generate(pickup_marker=4, pickup_path_no=1, dropoff_path_no=3,
                    return_pickup_path_no=4, return_marker=5,
                    return_dropoff_path_no=1)
    # → опубликовать name в /scenario_name
"""

import argparse
import json
import os
import re
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, 'template_roundtrip.json')

# Каталог сценариев робота. Тот же путь задан в
# scenario_control/launch/scenario_control_json.launch.
#
# Ходовой процесс и генератор смотрят в один и тот же каталог: файлы никуда
# не передаются, это bind mount. Поэтому путь задаётся снаружи —
# в docker-compose.yml приложения и в launch-файле робота он разный.
SCENARIO_DIR = os.getenv('SCENARIO_DIR', '/scenarios')

PREFIX = 'run_'          # имена сгенерированных сценариев
PLACEHOLDER = re.compile(r'^\{\{(\w+)\}\}$')


def _substitute(node, params):
    """Рекурсивно заменить строки вида {{key}} значениями из params.
    Тип берётся из params — marker_id должен остаться числом, а не строкой."""
    if isinstance(node, dict):
        return {k: _substitute(v, params) for k, v in node.items()}
    if isinstance(node, list):
        return [_substitute(v, params) for v in node]
    if isinstance(node, str):
        m = PLACEHOLDER.match(node)
        if m:
            key = m.group(1)
            if key not in params:
                raise KeyError(f'не задан параметр {key}')
            return params[key]
    return node


def render(params, template=TEMPLATE):
    """Вернуть готовый сценарий как dict. Файл не пишется."""
    with open(template, encoding='utf-8') as f:
        tpl = json.load(f)
    out = _substitute(tpl, params)
    left = _find_placeholders(out)
    if left:
        raise ValueError(f'остались незаполненные плейсхолдеры: {sorted(left)}')
    return out


def _find_placeholders(node, acc=None):
    acc = set() if acc is None else acc
    if isinstance(node, dict):
        for v in node.values():
            _find_placeholders(v, acc)
    elif isinstance(node, list):
        for v in node:
            _find_placeholders(v, acc)
    elif isinstance(node, str):
        m = PLACEHOLDER.match(node)
        if m:
            acc.add(m.group(1))
    return acc


def generate(pickup_marker, pickup_path_no, dropoff_path_no,
             return_pickup_path_no, return_marker, return_dropoff_path_no,
             scenario_dir=SCENARIO_DIR, name=None, template=TEMPLATE):
    """Отрисовать сценарий и записать в каталог робота. Вернуть имя без .json,
    которое нужно опубликовать в /scenario_name."""
    if name is None:
        name = f'{PREFIX}{int(time.time())}'
    params = {
        'scenario_name': name,
        'pickup_marker': int(pickup_marker),
        'pickup_path_no': int(pickup_path_no),
        'dropoff_path_no': int(dropoff_path_no),
        'return_pickup_path_no': int(return_pickup_path_no),
        'return_marker': int(return_marker),
        'return_dropoff_path_no': int(return_dropoff_path_no),
    }
    data = render(params, template)
    _write_atomic(scenario_dir, name, data)
    return name


def _write_atomic(scenario_dir, name, data):
    """Записать <name>.json в каталог робота. Атомарно: движок может читать
    каталог в этот же момент, и недописанный файл сломал бы разбор JSON."""
    os.makedirs(scenario_dir, exist_ok=True)
    path = os.path.join(scenario_dir, name + '.json')
    fd, tmp = tempfile.mkstemp(dir=scenario_dir, prefix='.tmp_', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.flush()
            os.fsync(f.fileno())
        # mkstemp даёт 0600, и os.replace эти права сохраняет. Движок может
        # работать под другим пользователем (сервер — процесс хоста, движок —
        # root в контейнере), и тогда файл окажется нечитаемым.
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ======================================================================
# Фрагменты — рейс из отдельных сценариев («путь 0», вторая ступень)
#
# Движок держит очередь /scenario_name и выполняет имена по одному, поэтому
# рейс можно собирать из коротких сценариев: сервер публикует следующий
# фрагмент, когда предыдущий завершился. Развилка «возвращать порожнюю или
# нет» тогда принимается после put_down, а не при старте.
#
# Шаблоны лежат в fragments/, константы объекта (карты, HOME, лифт) — в
# floors.json. Схема цепочек — docs/SitePorterScenario/scenario.drawio.
#
# Правило движка: упавший сценарий НЕ очищает очередь. Поэтому фрагменты
# публикуются строго по одному — никогда не класть в очередь всю цепочку.

FRAG_DIR = os.path.join(HERE, 'fragments')
FLOORS_FILE = os.path.join(HERE, 'floors.json')
FRAGMENTS = ('init', 'pick_up', 'move_to_target', 'elv', 'put_down', 'return_home')


def load_floors(path=FLOORS_FILE):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _floor(floors, no):
    try:
        return floors['floors'][str(no)]
    except KeyError:
        raise KeyError(f'этаж {no} не описан в floors.json')


def home_floor(floors):
    """Этаж, на котором стоит HOME. Он один."""
    homes = [int(k) for k, v in floors['floors'].items() if 'home' in v]
    if len(homes) != 1:
        raise ValueError(f'в floors.json должен быть ровно один этаж с home, есть {homes}')
    return homes[0]


# --- параметры фрагментов ---------------------------------------------

def init_params(floor, floors):
    fl = _floor(floors, floor)
    if 'home' not in fl:
        raise ValueError(f'init возможен только с этажа HOME, этаж {floor} без home')
    h = fl['home']
    return {'map_no': fl['map_no'],
            'home_x': h['x'], 'home_y': h['y'], 'home_yaw': h['yaw']}


def route_params(floor, path_no, floors):
    """move_to_target / return_home: карта этажа + номер маршрута."""
    return {'map_no': _floor(floors, floor)['map_no'], 'path_no': int(path_no)}


def pickup_params(floor, path_no, marker_id, floors):
    p = route_params(floor, path_no, floors)
    p['marker_id'] = int(marker_id)
    return p


def elv_params(from_floor, to_floor, floors):
    key = f'{from_floor}->{to_floor}'
    try:
        e = floors['elevator'][key]
    except KeyError:
        raise KeyError(f'переход {key} не описан в floors.json')
    src, dst = _floor(floors, from_floor), _floor(floors, to_floor)
    return {'start_floor': int(from_floor), 'goal_floor': int(to_floor),
            'elv_pose_map_no': src['map_no'],
            'elv_pose_path_no': src['elv_pose_path_no'],
            'exit_offset': e['exit_offset'],
            'goal_map_no': dst['map_no'],
            'init_pose_x': e['init_pose']['x'], 'init_pose_y': e['init_pose']['y'],
            'init_pose_yaw': e['init_pose']['yaw']}


# --- рендер и запись ----------------------------------------------------

def render_fragment(kind, params, name='fragment'):
    """Готовый фрагмент как dict. Файл не пишется."""
    if kind not in FRAGMENTS:
        raise ValueError(f'неизвестный фрагмент {kind}, есть {FRAGMENTS}')
    return render(dict(params, scenario_name=name),
                  os.path.join(FRAG_DIR, kind + '.json'))


def fragment_name(run_id, seq, kind):
    """run_<run_id>_<NN>_<kind>: по имени в robot_state.scenario_name видно,
    какой рейс и на каком шаге."""
    return f'{PREFIX}{run_id}_{seq:02d}_{kind}'


def generate_fragment(kind, params, run_id, seq, scenario_dir=SCENARIO_DIR):
    """Записать один фрагмент в каталог робота. Вернуть имя для /scenario_name."""
    name = fragment_name(run_id, seq, kind)
    _write_atomic(scenario_dir, name, render_fragment(kind, params, name))
    return name


# --- цепочки (по scenario.drawio) --------------------------------------
#
# План — список (kind, params). Сервер идёт по нему, публикуя по одному
# фрагменту и дожидаясь завершения. У deliver план обрывается на put_down
# (go_home=False), и после него сервер решает: приклеить collect
# (from_home=False) или plan_go_home().
#
# pickup  = {'floor', 'path_no', 'marker_id'} — где стоит платформа
# dropoff = {'floor', 'path_no'}              — куда её поставить

def _elv_wait(floor, floors):
    """Позиция ожидания лифта на этаже (elv_wait_pose_path_no)."""
    return ('move_to_target',
            route_params(floor, _floor(floors, floor)['elv_wait_pose_path_no'], floors))


def _transfer(from_floor, to_floor, floors):
    """Переезд между этажами: холл → лифт. На одном этаже лифт не нужен,
    но такой рейс на роботе не проверялся."""
    if int(from_floor) == int(to_floor):
        raise NotImplementedError(f'рейс в пределах этажа {from_floor} не поддержан')
    return [_elv_wait(from_floor, floors), ('elv', elv_params(from_floor, to_floor, floors))]


def plan_go_home(floor, floors=None):
    """С любого этажа в HOME. С этажа HOME — только return_home."""
    floors = floors or load_floors()
    hf = home_floor(floors)
    steps = []
    if int(floor) != hf:
        steps += _transfer(floor, hf, floors)
        steps.append(_elv_wait(hf, floors))
    steps.append(('return_home', route_params(hf, _floor(floors, hf)['home_path_no'], floors)))
    return steps


def plan_deliver(pickup, dropoff, floors=None, from_home=True, go_home=True):
    floors = floors or load_floors()
    steps = []
    if from_home:
        steps.append(('init', init_params(pickup['floor'], floors)))
    steps.append(('pick_up', pickup_params(pickup['floor'], pickup['path_no'],
                                           pickup['marker_id'], floors)))
    steps += _transfer(pickup['floor'], dropoff['floor'], floors)
    steps.append(('move_to_target', route_params(dropoff['floor'], dropoff['path_no'], floors)))
    steps.append(('put_down', {}))
    if go_home:
        steps += plan_go_home(dropoff['floor'], floors)
    return steps


def plan_collect(pickup, dropoff, floors=None, from_home=True, go_home=True):
    """Возврат порожней. from_home=False — хвост после put_down доставки:
    робот уже на этаже pickup, init и переезд не нужны."""
    floors = floors or load_floors()
    steps = []
    if from_home:
        hf = home_floor(floors)
        steps.append(('init', init_params(hf, floors)))
        # После лифта — сразу к порожней. Заход на elv_wait этажа прибытия был
        # лишним крюком: выход из лифта и так стоит у дверей, а доставка после
        # лифта тоже едет прямо на адрес (проверено рейсом deliver_collect).
        steps += _transfer(hf, pickup['floor'], floors)
    steps.append(('pick_up', pickup_params(pickup['floor'], pickup['path_no'],
                                           pickup['marker_id'], floors)))
    steps += _transfer(pickup['floor'], dropoff['floor'], floors)
    steps.append(('move_to_target', route_params(dropoff['floor'], dropoff['path_no'], floors)))
    steps.append(('put_down', {}))
    if go_home:
        steps += plan_go_home(dropoff['floor'], floors)
    return steps


def plan_deliver_collect(pickup, dropoff, collect_pickup, collect_dropoff, floors=None):
    """Полный рейс как press_scenario_4: доставка + возврат порожней."""
    floors = floors or load_floors()
    return (plan_deliver(pickup, dropoff, floors, go_home=False)
            + plan_collect(collect_pickup, collect_dropoff, floors, from_home=False))


def generate_chain(plan, run_id=None, scenario_dir=SCENARIO_DIR):
    """Записать все фрагменты плана. Вернуть имена в порядке публикации.
    Публиковать по одному, следующее — после завершения предыдущего."""
    if run_id is None:
        run_id = str(int(time.time()))
    return [generate_fragment(kind, params, run_id, seq, scenario_dir)
            for seq, (kind, params) in enumerate(plan, 1)]


def chain_steps(plan):
    """Все шаги плана подряд — для сравнения с монолитным сценарием."""
    out = []
    for kind, params in plan:
        out += render_fragment(kind, params)['steps']
    return out


def cleanup(scenario_dir=SCENARIO_DIR, keep_seconds=24 * 3600):
    """Удалить старые сгенерированные сценарии. Файлы без префикса run_
    не трогаются никогда — они лежат в git."""
    now = time.time()
    removed = []
    for f in os.listdir(scenario_dir):
        if not f.startswith(PREFIX) or not f.endswith('.json'):
            continue
        p = os.path.join(scenario_dir, f)
        if now - os.path.getmtime(p) > keep_seconds:
            os.unlink(p)
            removed.append(f)
    return removed


def main():
    ap = argparse.ArgumentParser(description='SitePorter: сгенерировать сценарий для робота')
    ap.add_argument('--pickup-marker', type=int, required=True,
                    help='маркер платформы, которую забираем на 2F')
    ap.add_argument('--pickup-path', type=int, required=True,
                    help='path_no места, где эта платформа стоит на 2F')
    ap.add_argument('--dropoff-path', type=int, required=True,
                    help='path_no места выгрузки на 1F')
    ap.add_argument('--return-pickup-path', type=int, required=True,
                    help='path_no места, откуда забираем порожнюю на 1F')
    ap.add_argument('--return-marker', type=int, required=True,
                    help='маркер порожней платформы')
    ap.add_argument('--return-dropoff-path', type=int, required=True,
                    help='path_no места на 2F, куда ставим порожнюю платформу')
    ap.add_argument('--name', help='имя сценария (по умолчанию run_<timestamp>)')
    ap.add_argument('--scenario-dir', default=SCENARIO_DIR)
    ap.add_argument('--dry-run', action='store_true', help='вывести JSON, не записывая')
    a = ap.parse_args()

    params = {
        'scenario_name': a.name or f'{PREFIX}dryrun',
        'pickup_marker': a.pickup_marker,
        'pickup_path_no': a.pickup_path,
        'dropoff_path_no': a.dropoff_path,
        'return_pickup_path_no': a.return_pickup_path,
        'return_marker': a.return_marker,
        'return_dropoff_path_no': a.return_dropoff_path,
    }
    if a.dry_run:
        print(json.dumps(render(params), ensure_ascii=False, indent=4))
        return

    name = generate(a.pickup_marker, a.pickup_path, a.dropoff_path,
                    a.return_pickup_path, a.return_marker, a.return_dropoff_path,
                    scenario_dir=a.scenario_dir, name=a.name)
    print(name)
    print(f'  файл:      {os.path.join(a.scenario_dir, name + ".json")}')
    print(f'  запустить: rostopic pub -1 /scenario_name std_msgs/String "data: \'{name}\'"')


if __name__ == '__main__':
    main()
