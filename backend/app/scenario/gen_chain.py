#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SitePorter — собрать рейс из фрагментов и записать их в каталог робота.

Для ручного прогона без сервера. Печатает имена в порядке публикации;
публиковать по одному, следующее — после завершения предыдущего
(упавший сценарий не очищает очередь движка).

    # как press_scenario_4: платформа 4 с 2F path 1 → 1F path 3,
    # обратно порожняя 5 с 1F path 4 → 2F path 1
    python3 gen_chain.py deliver_collect --pickup 2:1:4 --dropoff 1:3 \
                         --collect-pickup 1:4:5 --collect-dropoff 2:1

    python3 gen_chain.py deliver --pickup 2:1:4 --dropoff 1:3
    python3 gen_chain.py collect --pickup 1:4:5 --dropoff 2:1

    # развилка сервера руками: доставка до put_down, потом хвост возврата
    python3 gen_chain.py deliver --pickup 2:1:4 --dropoff 1:3 --no-home
    python3 gen_chain.py collect --pickup 1:4:5 --dropoff 2:1 --no-init

Формат: --pickup ЭТАЖ:PATH:МАРКЕР, --dropoff ЭТАЖ:PATH.
--dry-run печатает план, не записывая.
"""

import argparse
import json
import os

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
    """Аргументы, описывающие рейс. Общие для gen_chain.py и run_chain.py."""
    ap.add_argument('chain', choices=['deliver', 'collect', 'deliver_collect'])
    ap.add_argument('--pickup', type=_pickup, required=True, help='ЭТАЖ:PATH:МАРКЕР')
    ap.add_argument('--dropoff', type=_dropoff, required=True, help='ЭТАЖ:PATH')
    ap.add_argument('--collect-pickup', type=_pickup, help='deliver_collect: порожняя')
    ap.add_argument('--collect-dropoff', type=_dropoff, help='deliver_collect: куда её')
    ap.add_argument('--no-init', action='store_true',
                    help='без init и переезда с HOME: робот уже на месте '
                         '(хвост collect после доставки)')
    ap.add_argument('--no-home', action='store_true',
                    help='остановиться после put_down, домой не ехать '
                         '(deliver до развилки)')


def build_plan(a, ap=None):
    """План по аргументам add_plan_args()."""
    floors = load_floors()
    from_home, go_home = not a.no_init, not a.no_home
    if a.chain == 'deliver':
        return plan_deliver(a.pickup, a.dropoff, floors, from_home, go_home)
    if a.chain == 'collect':
        return plan_collect(a.pickup, a.dropoff, floors, from_home, go_home)
    if not (a.collect_pickup and a.collect_dropoff):
        msg = 'deliver_collect требует --collect-pickup и --collect-dropoff'
        if ap:
            ap.error(msg)
        raise ValueError(msg)
    if a.no_init or a.no_home:
        msg = 'deliver_collect всегда из HOME в HOME; --no-init/--no-home не применимы'
        if ap:
            ap.error(msg)
        raise ValueError(msg)
    return plan_deliver_collect(a.pickup, a.dropoff,
                                a.collect_pickup, a.collect_dropoff, floors)


def main():
    ap = argparse.ArgumentParser(description='SitePorter: рейс из фрагментов')
    add_plan_args(ap)
    ap.add_argument('--run-id', help='по умолчанию timestamp')
    ap.add_argument('--scenario-dir', default=SCENARIO_DIR)
    ap.add_argument('--dry-run', action='store_true', help='показать план, не записывая')
    a = ap.parse_args()
    plan = build_plan(a, ap)

    if a.dry_run:
        for seq, (kind, params) in enumerate(plan, 1):
            print(f'{seq:02d} {kind:15s} {json.dumps(params, ensure_ascii=False)}')
            for s in render_fragment(kind, params)['steps']:
                print('      ', json.dumps(s, ensure_ascii=False))
        return

    names = generate_chain(plan, a.run_id, a.scenario_dir)
    print(f'{len(names)} фрагментов в {a.scenario_dir}')
    print('публиковать по одному, дождавшись завершения предыдущего'
          ' (или run_chain.py — он делает это сам):')
    for n in names:
        print(f'  rostopic pub -1 /scenario_name std_msgs/String "data: \'{n}\'"')


if __name__ == '__main__':
    main()
