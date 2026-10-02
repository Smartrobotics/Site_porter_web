#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json

from gen_scenario import (SCENARIO_DIR, generate_chain, load_floors,
                          plan_collect, plan_deliver, plan_deliver_collect,
                          render_fragment)


def _pickup(s):
    floor, path_no, marker = (int(x) for x in s.split(':'))
    return {'floor': floor, 'path_no': path_no, 'marker_id': marker}


def _dropoff(s):
    floor, path_no = (int(x) for x in s.split(':'))
    return {'floor': floor, 'path_no': path_no}


def add_plan_args(ap):
    ap.add_argument('chain', choices=['deliver', 'collect', 'deliver_collect'])
    ap.add_argument('--pickup', type=_pickup, required=True, help='FLOOR:PATH:MARKER')
    ap.add_argument('--dropoff', type=_dropoff, required=True, help='FLOOR:PATH')
    ap.add_argument('--collect-pickup', type=_pickup, help='deliver_collect: the empty rack')
    ap.add_argument('--collect-dropoff', type=_dropoff, help='deliver_collect: where it goes')
    ap.add_argument('--no-init', action='store_true',
                    help='no init and no trip from HOME: the robot is already there '
                         '(the collect tail after a delivery)')
    ap.add_argument('--no-home', action='store_true',
                    help='stop after put_down, do not drive home '
                         '(deliver up to the split)')


def build_plan(a, ap=None):
    floors = load_floors()
    from_home, go_home = not a.no_init, not a.no_home
    if a.chain == 'deliver':
        return plan_deliver(a.pickup, a.dropoff, floors, from_home, go_home)
    if a.chain == 'collect':
        return plan_collect(a.pickup, a.dropoff, floors, from_home, go_home)
    if not (a.collect_pickup and a.collect_dropoff):
        msg = 'deliver_collect needs --collect-pickup and --collect-dropoff'
        if ap:
            ap.error(msg)
        raise ValueError(msg)
    if a.no_init or a.no_home:
        msg = 'deliver_collect always runs HOME to HOME; --no-init/--no-home do not apply'
        if ap:
            ap.error(msg)
        raise ValueError(msg)
    return plan_deliver_collect(a.pickup, a.dropoff,
                                a.collect_pickup, a.collect_dropoff, floors)


def main():
    ap = argparse.ArgumentParser(description='SitePorter: a trip built out of fragments')
    add_plan_args(ap)
    ap.add_argument('--run-id', help='defaults to a timestamp')
    ap.add_argument('--scenario-dir', default=SCENARIO_DIR)
    ap.add_argument('--dry-run', action='store_true', help='print the plan without writing')
    a = ap.parse_args()
    plan = build_plan(a, ap)

    if a.dry_run:
        for seq, (kind, params) in enumerate(plan, 1):
            print(f'{seq:02d} {kind:15s} {json.dumps(params, ensure_ascii=False)}')
            for s in render_fragment(kind, params)['steps']:
                print('      ', json.dumps(s, ensure_ascii=False))
        return

    names = generate_chain(plan, a.run_id, a.scenario_dir)
    print(f'{len(names)} fragments in {a.scenario_dir}')
    print('publish them one at a time, each after the previous one finishes'
          ' (or use run_chain.py, which does that for you):')
    for n in names:
        print(f'  rostopic pub -1 /scenario_name std_msgs/String "data: \'{n}\'"')


if __name__ == '__main__':
    main()
