import pytest
from checkout import apply_discount, CartEmptyError


def test_apply_discount_reduces_total():
    cart = {"items": [{"price": 100}], "total": 100}
    result = apply_discount(cart, "SAVE10")
    assert result["total"] == 90


def test_apply_discount_raises_on_empty_cart():
    cart = {"items": [], "total": 0}
    with pytest.raises(CartEmptyError):
        apply_discount(cart, "SAVE10")


def test_apply_discount_ignores_invalid_code():
    cart = {"items": [{"price": 100}], "total": 100}
    result = apply_discount(cart, "NOT-A-REAL-CODE")
    assert result["total"] == 100
