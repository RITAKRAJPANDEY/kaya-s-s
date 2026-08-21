#!/usr/bin/env python3
# Copyright (C) 2024-present Naver Corporation. All rights reserved.
# Licensed under CC BY-NC-SA 4.0 (non-commercial use only).
#
# --------------------------------------------------------
# dust3r gradio demo executable
# --------------------------------------------------------
import torch

from dust3r.demo import main

import matplotlib.pyplot as pl
pl.ion()

torch.backends.cuda.matmul.allow_tf32 = True  # for gpu >= Ampere and pytorch >= 1.12


if __name__ == '__main__':
    main()
