# Python ASMK (Aggregated Selective Match Kernels)

This is an easy **pip installable** version of ASMK ([original repo](https://github.com/jenicek/asmk)).

```
@InProceedings{TAJ13,
  author       = "Giorgos Tolias and Yannis Avrithis and Herv\'e J\'egou",
  title        = "To aggregate or not to aggregate: Selective match kernels for image search",
  booktitle    = "IEEE International Conference on Computer Vision",
  year         = "2013"
}
```


## Installation (CPU)

### From git

```bash
pip install "asmk[cpu] @ git+https://github.com/lojzezust/asmk.git"
```

### Clone and install

```bash
git clone https://github.com/lojzezust/asmk.git
pip install 'asmk[cpu]'
```

## Installation (GPU)
**NOTE:** The package also provides a [gpu] target, but is subject to availability of `faiss-gpu` on your platform.

### From git

```bash
pip install "asmk[gpu] @ git+https://github.com/lojzezust/asmk.git"
```

### Clone and install

```bash
git clone https://github.com/lojzezust/asmk.git
pip install 'asmk[gpu]'
```
