# Copyright (C) 2025-present Naver Corporation. All rights reserved.
import os
from setuptools import setup, find_packages

curope_dep = ['curope @ git+https://github.com/naver/croco.git@croco_module#subdirectory=curope']
optional_dep = [
    'pillow-heif',
    'pyrender',
]

setup(
    name="dust3r",
    version="1.0.0",
    packages=find_packages(include=["dust3r", "dust3r.*"]),
    install_requires=[
        'torch',
        'torchvision',
        'matplotlib',
        'scikit-learn',
        'tqdm',
        'numpy',
        'numpy-quaternion',
        'opencv-python',
        'einops',
        'tensorboard',
        'h5py',
        'pillow',
        'roma',
        'gradio',
        'scipy',
        'trimesh',
        'pyglet<2',
        'huggingface-hub[torch]>=0.22',
        'croco @ git+https://github.com/naver/croco.git@croco_module#egg=croco'
    ],
    python_requires=">=3.11",
    extras_require={
        "curope": curope_dep,
        "optional": optional_dep,
        "all": curope_dep + optional_dep

    },
    entry_points={
        'console_scripts': [
            'dust3r_demo=dust3r.demo:main'
        ]
    }
)
