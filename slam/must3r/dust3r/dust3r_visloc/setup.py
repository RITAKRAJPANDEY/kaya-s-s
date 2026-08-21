# Copyright (C) 2025-present Naver Corporation. All rights reserved.
import os
from setuptools import setup, find_packages

ROOT = os.path.abspath(os.path.dirname(__file__))
ROOT = os.path.normpath(os.path.join(ROOT, "../"))
LOCAL_DUST3R = os.path.isdir(os.path.join(ROOT, "dust3r"))

if LOCAL_DUST3R:
    # Use a file:// URL to install dust3r
    dust3r_dep = f"dust3r @ file://{ROOT}"
else:
    # Fallback to fetching dust3r from URL
    dust3r_dep = (
        "dust3r @ git+https://github.com/naver/dust3r.git@dust3r_setup"
    )


setup(
    name="dust3r_visloc",
    version="1.0.0",
    packages=find_packages(include=["dust3r_visloc", "dust3r_visloc.*"]),
    install_requires=[
        dust3r_dep,
        'kapture',
        'kapture-localization',
        'numpy-quaternion',
        'pycolmap',
        'poselib',
    ],
    python_requires=">=3.11",
)
