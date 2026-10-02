#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_scenario import (render, generate, cleanup, PREFIX,
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


MFT_PATH_CHECK_KEYS = ('obstacle_check', 'clear_dist', 'block_timeout', 'edge_x')


def no_path_check(steps):
    return [{k: v for k, v in s.items() if k not in MFT_PATH_CHECK_KEYS}
            if s.get('action') == 'move_forward_time' else s
            for s in steps]


print('1. Match against the verified scenarios')
CASES = [
    ('press_scenario_4', dict(pickup_marker=4, pickup_path_no=1, dropoff_path_no=3,
                              return_pickup_path_no=4, return_marker=5,
                              return_dropoff_path_no=1)),
    ('press_scenario_5', dict(pickup_marker=5, pickup_path_no=1, dropoff_path_no=4,
                              return_pickup_path_no=3, return_marker=4,
                              return_dropoff_path_no=1)),
]
for name, params in CASES:
    path = os.path.join(SCEN, name + '.json')
    if not os.path.exists(path):
        skip(name, 'no reference; set ROBOT_REPO')
        continue
    want = json.load(open(path, encoding='utf-8'))
    got = render(dict(params, scenario_name=name))
    got['steps'] = no_path_check(got['steps'])
    if got == want:
        check(name, True)
    else:
        diffs = [f'step {i}' for i, (a, b) in enumerate(zip(got['steps'], want['steps'])) if a != b]
        check(name, False, 'differ at ' + ', '.join(diffs[:5]))

print('\n2. Parameter substitution')
p = dict(scenario_name='t', pickup_marker=11, pickup_path_no=12, dropoff_path_no=13,
         return_pickup_path_no=14, return_marker=15, return_dropoff_path_no=16)
s = render(p)['steps']
check('step 4  pickup_path_no',         s[4].get('path_no') == 12)
check('step 6  pickup_marker',          s[6].get('marker_id') == 11)
check('step 26 dropoff_path_no',        s[26].get('path_no') == 13)
check('step 32 return_pickup_path_no',  s[32].get('path_no') == 14)
check('step 34 return_marker',          s[34].get('marker_id') == 15)
check('step 57 return_dropoff_path_no', s[57].get('path_no') == 16)
check('values stayed numbers', all(isinstance(v, int) for v in
      (s[4]['path_no'], s[6]['marker_id'], s[57]['path_no'])))

print('\n3. Incomplete parameters are rejected')
try:
    render({'scenario_name': 'x', 'pickup_marker': 1})
    check('incomplete set rejected', False, 'no exception raised')
except KeyError as e:
    check('incomplete set rejected', True, str(e))

print('\n4. Writing to a temporary directory')
tmp = tempfile.mkdtemp(prefix='scen_selftest_')
try:
    name = generate(pickup_marker=1, pickup_path_no=4, dropoff_path_no=3,
                    return_pickup_path_no=4, return_marker=2,
                    return_dropoff_path_no=2, scenario_dir=tmp, name='run_selftest')
    f = os.path.join(tmp, name + '.json')
    check('file created', os.path.exists(f))
    d = json.load(open(f, encoding='utf-8'))
    check('valid JSON, 65 steps', len(d.get('steps', [])) == 65, str(len(d.get('steps', []))))
    check('name inside matches', d.get('name') == name, str(d.get('name')))
    check('no placeholders left', '{{' not in open(f, encoding='utf-8').read())
    check('temporary files are gone', not [x for x in os.listdir(tmp) if x.startswith('.tmp_')])

    print('\n5. cleanup removes only run_*')
    keep = os.path.join(tmp, 'press_scenario_4.json')
    shutil.copy(f, keep)
    removed = cleanup(scenario_dir=tmp, keep_seconds=0)
    check('run_* removed', name + '.json' in removed)
    check('a foreign file is left alone', os.path.exists(keep))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\n6. The robot scenario directory')
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

print('\n7. Fragments match docs/SitePorterScenario')
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

print('\n8. Chains as drawn in scenario.drawio')
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

print('\n9. deliver_collect == press_scenario_4 (+2 deliberate differences)')
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

print('\n10. Writing a chain to a temporary directory')
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
    removed = cleanup(scenario_dir=tmp, keep_seconds=0)
    check('cleanup removes the fragments', sorted(removed) == sorted(n + '.json' for n in names))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\n11. Invalid parameters are rejected')
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
