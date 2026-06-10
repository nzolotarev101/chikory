"""Pre-parity smoke (full contract parity lands in WP-201): the package
imports and its public surface is intact."""

import chikory


def test_public_surface() -> None:
    assert set(chikory.__all__) <= set(dir(chikory))
