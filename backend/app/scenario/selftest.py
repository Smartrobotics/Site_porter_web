#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_scenario import (cleanup, PREFIX,
                          load_floors, render_fragment, chain_steps, generate_chain,
                          plan_deliver, plan_collect, plan_deliver_collect,
                          fragment_name, FRAGMENTS)

HERE = os.path.dirname(os.path.abspath(__file__))
ROBOT_REPO = os.getenv('ROBOT_REPO', os.path.normpath(os.path.join(
    HERE, '..', '..', '..', '..', 'takuhai_container_ws', 'Taisei_takuhai_system')))
SCEN = os.getenv('ROBOT_SCENARIO_DIR',
                 os.path.join(ROBOT_REPO, 'src', 'scenario_control', 'scenarios'))

ok = True
skipped = 0


def skip(name, why):
    global skipped
    skipped += 1
    print(f'  [SKIP] {name}  — {why}')


def check(name, cond, detail=''):
    global ok
    print(f"  [{'OK ' if cond else 'FAIL'}] {name}{'  — ' + detail if detail and not cond else ''}")
    if not cond:
        ok = False


# Step options that exist only in the site fragments (the robot references
# predate them): path check / distance on move_forward_time, per-step inflation
# on start_navigation. Compared without them.
SITE_ONLY_KEYS = {
    'move_forward_time': ('obstacle_check', 'clear_dist', 'block_timeout', 'edge_x', 'distance'),
    'start_navigation': ('inflation_cost_scaling', 'inflation_radius'),
}


def no_path_check(steps):
    return [{k: v for k, v in s.items() if k not in SITE_ONLY_KEYS.get(s.get('action'), ())}
            for s in steps]


print('1. The robot scenario directory')
stray = [f for f in os.listdir(SCEN) if f.startswith(PREFIX)] if os.path.isdir(SCEN) else []
check('no generated files left behind', not stray, ', '.join(stray))

DOCS_FRAG = os.getenv('ROBOT_DOCS_DIR',
                      os.path.join(ROBOT_REPO, 'docs', 'SitePorterScenario'))
FLOORS = load_floors()

LEGACY_FLOORS = {
    'floors': {
        '2': {'map_no': 14, 'home': {'x': -3.678, 'y': -6.48, 'yaw': 359.8},
              'home_path_no': 4, 'elv_wait_pose_path_no': 3, 'elv_pose_path_no': 2},
        '1': {'map_no': 13, 'elv_wait_pose_path_no': 2, 'elv_pose_path_no': 1},
    },
    'elevator': {
        '2->1': {'exit_offset': 3.6, 'init_pose': {'x': 0.58, 'y': -0.014, 'yaw': 359.8}},
        '1->2': {'exit_offset': 3.3, 'init_pose': {'x': 0.807, 'y': -0.094, 'yaw': 359.5}},
    },
}

PICKUP = {'floor': 2, 'path_no': 1, 'marker_id': 4}
DROPOFF = {'floor': 1, 'path_no': 3}
C_PICKUP = {'floor': 1, 'path_no': 4, 'marker_id': 5}
C_DROPOFF = {'floor': 2, 'path_no': 1}

print('\n2. Fragments match docs/SitePorterScenario')
REF_PARAMS = {
    'init':           {'map_no': 14, 'home_x': -3.678, 'home_y': -6.48, 'home_yaw': 359.8},
    'pick_up':        {'map_no': 14, 'path_no': 1, 'marker_id': 4},
    'move_to_target': {'map_no': 14, 'path_no': 3},
    'return_home':    {'map_no': 14, 'path_no': 4},
    'put_down':       {},
    'elv':            {'start_floor': 2, 'goal_floor': 1, 'elv_pose_map_no': 14,
                       'elv_pose_path_no': 2, 'exit_offset': 3.6, 'goal_map_no': 13,
                       'init_pose_x': 0.58, 'init_pose_y': -0.014, 'init_pose_yaw': 359.8},
}
for kind in FRAGMENTS:
    path = os.path.join(DOCS_FRAG, kind + '.json')
    if not os.path.exists(path):
        skip(kind, 'no reference; set ROBOT_REPO')
        continue
    want = json.load(open(path, encoding='utf-8'))['steps']
    got = no_path_check(render_fragment(kind, REF_PARAMS[kind])['steps'])
    if got == want:
        check(kind, True)
    else:
        diffs = [f'step {i}' for i, (a, b) in enumerate(zip(got, want)) if a != b]
        if len(got) != len(want):
            diffs.append(f'length {len(got)} vs {len(want)}')
        check(kind, False, 'differ at ' + ', '.join(diffs[:5]))

print('\n3. Chains as drawn in scenario.drawio')
FLOWS = {
    'deliver_collect': ['init', 'pick_up', 'move_to_target', 'elv', 'move_to_target',
                        'put_down', 'pick_up', 'move_to_target', 'elv', 'move_to_target',
                        'put_down', 'return_home'],
    'deliver':         ['init', 'pick_up', 'move_to_target', 'elv', 'move_to_target',
                        'put_down', 'move_to_target', 'elv', 'move_to_target', 'return_home'],
    'collect':         ['init', 'move_to_target', 'elv', 'pick_up',
                        'move_to_target', 'elv', 'move_to_target', 'put_down', 'return_home'],
}
PLANS = {
    'deliver_collect': plan_deliver_collect(PICKUP, DROPOFF, C_PICKUP, C_DROPOFF, LEGACY_FLOORS),
    'deliver':         plan_deliver(PICKUP, DROPOFF, LEGACY_FLOORS),
    'collect':         plan_collect(C_PICKUP, C_DROPOFF, LEGACY_FLOORS),
}
for name, want in FLOWS.items():
    got = [k for k, _ in PLANS[name]]
    check(name, got == want, ' → '.join(got))

try:
    live = {
        'deliver_collect': plan_deliver_collect(PICKUP, DROPOFF, C_PICKUP, C_DROPOFF, FLOORS),
        'deliver':         plan_deliver(PICKUP, DROPOFF, FLOORS),
        'collect':         plan_collect(C_PICKUP, C_DROPOFF, FLOORS),
    }
    for name, want in FLOWS.items():
        check('floors.json: ' + name, [k for k, _ in live[name]] == want)
except (KeyError, ValueError) as e:
    check('floors.json works for every chain', False, str(e))

split = (plan_deliver(PICKUP, DROPOFF, LEGACY_FLOORS, go_home=False)
         + plan_collect(C_PICKUP, C_DROPOFF, LEGACY_FLOORS, from_home=False))
check('deliver(go_home=False) + collect(from_home=False) == deliver_collect',
      split == PLANS['deliver_collect'])

def _s(d):
    return {**d, 'floor': str(d['floor'])}
check('floor as a string == floor as a number',
      plan_deliver_collect(_s(PICKUP), _s(DROPOFF), _s(C_PICKUP), _s(C_DROPOFF), LEGACY_FLOORS)
      == PLANS['deliver_collect'])

print('\n4. deliver_collect == press_scenario_4 (+2 deliberate differences)')
ref = os.path.join(SCEN, 'press_scenario_4.json')
if not os.path.exists(ref):
    skip('press_scenario_4', 'no reference; set ROBOT_REPO')
else:
    want = json.load(open(ref, encoding='utf-8'))['steps']
    want = (want[:4]
            + [{'action': 'lift_control', 'mode': 1, 'speed': 0.03, 'position': 0.0},
               {'action': 'move_forward_time', 'forward': 0}]
            + want[4:54] + want[57:])
    got = no_path_check(chain_steps(PLANS['deliver_collect']))
    if got == want:
        check('matches', True)
    else:
        diffs = [f'step {i}: {a} != {b}' for i, (a, b) in enumerate(zip(got, want)) if a != b]
        if len(got) != len(want):
            diffs.append(f'length {len(got)} vs {len(want)}')
        check('matches', False, '; '.join(diffs[:3]))

print('\n5. Writing a chain to a temporary directory')
tmp = tempfile.mkdtemp(prefix='scen_selftest_')
try:
    names = generate_chain(PLANS['deliver'], run_id='selftest', scenario_dir=tmp)
    check('names in order',
          names == [fragment_name('selftest', i, k) for i, (k, _) in enumerate(PLANS['deliver'], 1)],
          ', '.join(names))
    check('the first is run_selftest_01_init', names[0] == 'run_selftest_01_init', names[0])
    files = [os.path.join(tmp, n + '.json') for n in names]
    check('all files created', all(os.path.exists(f) for f in files))
    check('name inside matches', all(json.load(open(f, encoding='utf-8'))['name'] == n
                                        for f, n in zip(files, names)))
    check('no placeholders left', not any('{{' in open(f, encoding='utf-8').read() for f in files))
    check('temporary files are gone', not [x for x in os.listdir(tmp) if x.startswith('.tmp_')])
    keep = os.path.join(tmp, 'press_scenario_4.json')
    shutil.copy(files[0], keep)
    removed = cleanup(scenario_dir=tmp, keep_seconds=0)
    check('cleanup removes the fragments', sorted(removed) == sorted(n + '.json' for n in names))
    check('a foreign file is left alone', os.path.exists(keep))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\n6. Invalid parameters are rejected')
try:
    plan_deliver({'floor': 2, 'path_no': 1, 'marker_id': 4}, {'floor': 2, 'path_no': 3}, FLOORS)
    check('a same-floor trip is rejected', False, 'no exception raised')
except NotImplementedError:
    check('a same-floor trip is rejected', True)
try:
    plan_deliver({'floor': 3, 'path_no': 1, 'marker_id': 4}, DROPOFF, FLOORS)
    check('an unknown floor is rejected', False, 'no exception raised')
except KeyError:
    check('an unknown floor is rejected', True)
try:
    plan_deliver({'floor': 1, 'path_no': 1, 'marker_id': 4}, {'floor': 2, 'path_no': 1}, FLOORS)
    check('init from a non-HOME floor is rejected', False, 'no exception raised')
except ValueError:
    check('init from a non-HOME floor is rejected', True)
try:
    render_fragment('pick_up', {'map_no': 14})
    check('incomplete fragment parameters are rejected', False, 'no exception raised')
except KeyError:
    check('incomplete fragment parameters are rejected', True)

note = f' (reference comparisons skipped: {skipped})' if skipped else ''
print('\n' + ('ALL PASSED' if ok else 'FAILURES') + note)
sys.exit(0 if ok else 1)
