"""Lykia: agents and stablecoins on Arc Network through one API.

>>> from lykia import Lykia
>>> lykia = Lykia("lk_test_...", base_url="https://lykia-api-akdogan1.vercel.app")
>>> plan = lykia.intents.create(owner="0x...", text="send 5 USDC to alice", environment="testnet")
"""
from ._operations import OPENAPI_VERSION, OPERATIONS, Operation
from .client import AsyncLykia, Lykia, operation_path
from .errors import LykiaError, WebhookSignatureError
from .webhooks import construct_event, sign, verify

__all__ = [
    "AsyncLykia",
    "Lykia",
    "LykiaError",
    "WebhookSignatureError",
    "OPERATIONS",
    "OPENAPI_VERSION",
    "Operation",
    "construct_event",
    "operation_path",
    "sign",
    "verify",
]
__version__ = "0.1.0"
