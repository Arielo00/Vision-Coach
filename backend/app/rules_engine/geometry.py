from __future__ import annotations

import math
from typing import Sequence


Point = Sequence[float | None]


def joint_angle(a: Point, b: Point, c: Point) -> float | None:
    if any(value is None for point in (a, b, c) for value in point):
        return None
    bax = float(a[0]) - float(b[0])
    bay = float(a[1]) - float(b[1])
    bcx = float(c[0]) - float(b[0])
    bcy = float(c[1]) - float(b[1])
    denominator = math.hypot(bax, bay) * math.hypot(bcx, bcy)
    if denominator <= 1e-8:
        return None
    cosine = max(-1.0, min(1.0, (bax * bcx + bay * bcy) / denominator))
    return math.degrees(math.acos(cosine))


def midpoint(a: Point, b: Point) -> tuple[float, float] | None:
    if any(value is None for point in (a, b) for value in point):
        return None
    return ((float(a[0]) + float(b[0])) / 2, (float(a[1]) + float(b[1])) / 2)


def angle_from_vertical(upper: Point, lower: Point) -> float | None:
    if any(value is None for point in (upper, lower) for value in point):
        return None
    dx = float(upper[0]) - float(lower[0])
    dy = float(lower[1]) - float(upper[1])
    if math.hypot(dx, dy) <= 1e-8:
        return None
    return abs(math.degrees(math.atan2(dx, dy)))
