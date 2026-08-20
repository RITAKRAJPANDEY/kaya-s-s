import numpy as np
import pytest
from core.depth_estimator import DepthEstimator

def test_depth_estimator_metric_distance_calculation():
    # Test with Depth Anything V2 Metric model (direct physical depth)
    config = {
        "enabled": True,
        "path": "depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf",
        "is_metric": True,
        "scale_factor": 1.0,
        "run_every_n_frames": 3
    }
    
    estimator = DepthEstimator.__new__(DepthEstimator)
    estimator.config = config
    estimator.enabled = True
    estimator.is_metric = True
    estimator.scale_factor = 1.0
    
    # Create mock depth map with metric distance values in meters
    depth_map = np.ones((480, 640), dtype=np.float32) * 3.0
    depth_map[100:200, 100:200] = 5.2
    
    # Bbox inside 5.2m region
    dist = estimator.get_distance((105, 105, 195, 195), depth_map)
    assert dist == 5.2
    
    # Bbox inside 3.0m region
    dist_near = estimator.get_distance((10, 10, 50, 50), depth_map)
    assert dist_near == 3.0
    
    # Out of bounds bbox should clip gracefully
    dist_oob = estimator.get_distance((-50, -50, 1000, 1000), depth_map)
    assert dist_oob is not None

def test_depth_estimator_relative_distance_backward_compatibility():
    # Test legacy relative inverse depth model calculation
    config = {
        "enabled": True,
        "path": "depth-anything/Depth-Anything-V2-Small-hf",
        "is_metric": False,
        "scale_factor": 15.0,
        "run_every_n_frames": 3
    }
    
    estimator = DepthEstimator.__new__(DepthEstimator)
    estimator.config = config
    estimator.enabled = True
    estimator.is_metric = False
    estimator.scale_factor = 15.0
    
    # Inverse depth: 5.0 -> 15.0 / 5.0 = 3.0m
    depth_map = np.ones((480, 640), dtype=np.float32) * 3.0
    depth_map[100:200, 100:200] = 5.0
    
    dist = estimator.get_distance((105, 105, 195, 195), depth_map)
    assert dist == 3.0
