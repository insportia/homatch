"""The HOMATCH Blender scene factory: a validated SceneBuildSpec in, a real Blender scene out.

Runs inside Blender (`blender -b --factory-startup --python factory/build.py -- params.json`).
Only this package's own code ever runs; the spec is data.
"""
