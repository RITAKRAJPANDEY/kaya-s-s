# Copyright (C) 2024-present Naver Corporation. All rights reserved.
# Licensed under CC BY-NC-SA 4.0 (non-commercial use only).
#
# --------------------------------------------------------
# CroCo submodule import
# --------------------------------------------------------
import importlib
import sys


import sys
import os.path as path
HERE_PATH = path.normpath(path.dirname(__file__))
CROCO_REPO_PATH = path.normpath(path.join(HERE_PATH, '../../croco'))
CROCO_MODELS_PATH = path.join(CROCO_REPO_PATH, 'models')
CROCO_INIT_PATH = path.join(CROCO_REPO_PATH, '__init__.py')

# check the presence of models directory in repo to be sure its cloned
if path.isdir(CROCO_MODELS_PATH) and not path.isfile(CROCO_INIT_PATH):  # croco is a submodule (main branch)
    # workaround for sibling import
    sys.path.insert(0, CROCO_REPO_PATH)

    # rewrite croco submodule imports to look like the package
    def _alias(old: str, new: str):
        mod = importlib.import_module(new)
        sys.modules.setdefault(old, mod)
    _alias("croco.models", "models")
    _alias("croco.utils", "utils")
else:
    try:
        from croco.models.croco import CroCoNet   # croco installed as a module
    except ImportError as e:
        raise ImportError(f"croco is not initialized, could not find: {CROCO_MODELS_PATH}.\n "
                          "Did you forget to run 'git submodule update --init --recursive' ?")

# patch curope submodule when installed
try:
    import curope  # curope installed
    import models.curope
    models.curope.cuRoPE2D = curope.cuRoPE2D
except Exception as e:
    pass
