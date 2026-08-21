from setuptools import setup, Extension
from setuptools.command.build_ext import build_ext as _build_ext

try:
    from Cython.Build import cythonize
    HAVE_CYTHON = True
except ImportError:
    HAVE_CYTHON = False

class build_ext(_build_ext):
    def finalize_options(self):
        super().finalize_options()
        import numpy as np
        self.include_dirs.append(np.get_include())

sources = ["cython/hamming.pyx" if HAVE_CYTHON else "cython/hamming.c"]
extensions = [Extension("asmk.hamming", sources=sources, language="c")]
ext_modules = cythonize(extensions, language_level="3") if HAVE_CYTHON else extensions

setup(
    ext_modules=[],
)
