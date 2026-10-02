#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import re
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, 'template_roundtrip.json')

SCENARIO_DIR = os.getenv('SCENARIO_DIR', '/scenarios')

PREFIX = 'run_'
PLACEHOLDER = re.compile(r'^\{\{(\w+)\}\}$')


def _substitute(node, params):
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
    os.makedirs(scenario_dir, exist_ok=True)
    path = os.path.join(scenario_dir, name + '.json')
    fd, tmp = tempfile.mkstemp(dir=scenario_dir, prefix='.tmp_', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


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
    homes = [int(k) for k, v in floors['floors'].items() if 'home' in v]
    if len(homes) != 1:
        raise ValueError(f'в floors.json должен быть ровно один этаж с home, есть {homes}')
    return homes[0]


def init_params(floor, floors):
    fl = _floor(floors, floor)
    if 'home' not in fl:
        raise ValueError(f'init возможен только с этажа HOME, этаж {floor} без home')
    h = fl['home']
    return {'map_no': fl['map_no'],
            'home_x': h['x'], 'home_y': h['y'], 'home_yaw': h['yaw']}


def route_params(floor, path_no, floors):
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


def render_fragment(kind, params, name='fragment'):
    if kind not in FRAGMENTS:
        raise ValueError(f'неизвестный фрагмент {kind}, есть {FRAGMENTS}')
    return render(dict(params, scenario_name=name),
                  os.path.join(FRAG_DIR, kind + '.json'))


def fragment_name(run_id, seq, kind):
    return f'{PREFIX}{run_id}_{seq:02d}_{kind}'


def generate_fragment(kind, params, run_id, seq, scenario_dir=SCENARIO_DIR):
    name = fragment_name(run_id, seq, kind)
    _write_atomic(scenario_dir, name, render_fragment(kind, params, name))
    return name


def _elv_wait(floor, floors):
    return ('move_to_target',
            route_params(floor, _floor(floors, floor)['elv_wait_pose_path_no'], floors))


def _transfer(from_floor, to_floor, floors):
    if int(from_floor) == int(to_floor):
        raise NotImplementedError(f'рейс в пределах этажа {from_floor} не поддержан')
    return [_elv_wait(from_floor, floors), ('elv', elv_params(from_floor, to_floor, floors))]


def plan_go_home(floor, floors=None):
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
    floors = floors or load_floors()
    steps = []
    if from_home:
        hf = home_floor(floors)
        steps.append(('init', init_params(hf, floors)))
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
    floors = floors or load_floors()
    return (plan_deliver(pickup, dropoff, floors, go_home=False)
            + plan_collect(collect_pickup, collect_dropoff, floors, from_home=False))


def generate_chain(plan, run_id=None, scenario_dir=SCENARIO_DIR):
    if run_id is None:
        run_id = str(int(time.time()))
    return [generate_fragment(kind, params, run_id, seq, scenario_dir)
            for seq, (kind, params) in enumerate(plan, 1)]


def chain_steps(plan):
    out = []
    for kind, params in plan:
        out += render_fragment(kind, params)['steps']
    return out


def cleanup(scenario_dir=SCENARIO_DIR, keep_seconds=24 * 3600):
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
