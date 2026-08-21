"""NumPy fallback for ASMK's optional native Hamming implementation."""

import numpy as np


def binarize_and_pack(arr, threshold=0):
    values = np.asarray(arr) > threshold
    padding = (-values.size) % 32
    if padding:
        values = np.pad(values, (0, padding), constant_values=False)
    packed = np.packbits(values, bitorder='big')
    return packed.view('>u4').astype(np.uint32, copy=False)


def binarize_and_pack_2D(arr, threshold=0):
    values = np.asarray(arr) > threshold
    padding = (-values.shape[1]) % 32
    if padding:
        values = np.pad(values, ((0, 0), (0, padding)), constant_values=False)
    packed = np.packbits(values, axis=1, bitorder='big')
    return packed.view('>u4').astype(np.uint32, copy=False)


def hamming_dist_packed(n1, n2, normalization=0):
    n1 = np.asarray(n1, dtype=np.uint32)
    n2 = np.asarray(n2, dtype=np.uint32)
    assert n1.shape == n2.shape
    if normalization == 0:
        normalization = n1.size * 32
    return np.bitwise_count(np.bitwise_xor(n1, n2)).sum() / normalization


def hamming_cdist_packed(arr1, arr2, normalization=0):
    arr1 = np.asarray(arr1, dtype=np.uint32)
    arr2 = np.asarray(arr2, dtype=np.uint32)
    assert arr1.shape[1] == arr2.shape[1]
    if normalization == 0:
        normalization = arr1.shape[1] * 32
    xor = np.bitwise_xor(arr1[:, None, :], arr2[None, :, :])
    return np.bitwise_count(xor).sum(axis=2).astype(np.float32) / normalization