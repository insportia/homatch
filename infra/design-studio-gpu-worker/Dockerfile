# HOMATCH Design Studio — the Blender scene factory (Runpod Serverless).
#
# A separate compute service: it is not the Railway discovery worker and shares
# nothing with it. Built by Runpod from this directory (Dockerfile path
# infra/design-studio-gpu-worker/Dockerfile, build context the same directory).
#
#   * Blender 5.2.1 LTS, headless — the scene factory (the same version the worker tests run)
#   * Cycles on the GPU (OptiX, else CUDA; the host's NVIDIA driver), CPU as the fallback
#   * glTF-Transform 4.5.1 + KTX-Software 4.4.2 + Khronos validator (the catalogue's toolchain)
#
# No model weights, no tokens, no secrets — at build time or at run time.

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics \
    HM_BLENDER=/opt/blender/blender

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils python3 python3-pip \
      libgl1 libegl1 libglib2.0-0 libxi6 libxrender1 libxkbcommon0 libsm6 libice6 libxxf86vm1 libxfixes3 libx11-6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Node 20 + the glTF toolchain (pinned like .github/workflows/design-studio-catalog.yml).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/* \
    && npm install -g --no-audit --no-fund @gltf-transform/cli@4.5.1 \
    && mkdir -p /opt/hm-node && npm install --prefix /opt/hm-node --no-audit --no-fund gltf-validator@2.0.0-dev.3.10
ENV NODE_PATH=/opt/hm-node/node_modules
RUN curl -fsSL -o /tmp/ktx.deb https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Linux-x86_64.deb \
    && apt-get update && apt-get install -y /tmp/ktx.deb && rm -f /tmp/ktx.deb && rm -rf /var/lib/apt/lists/* && ktx --version

# Blender 5.2.1 LTS (headless): the factory's only executable code is worker/factory.
RUN curl -fsSL https://download.blender.org/release/Blender5.2/blender-5.2.1-linux-x64.tar.xz -o /tmp/blender.tar.xz \
    && mkdir -p /opt/blender && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && rm /tmp/blender.tar.xz \
    && /opt/blender/blender -b --factory-startup --python-expr "import bpy; print(bpy.app.version_string)"

COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt
COPY worker /app/worker
WORKDIR /app

# A build-time proof that the factory runs: the fixture home is built and exported on the CPU.
COPY tests/fixtures/apartment.spec.json /app/selftest/apartment.spec.json
RUN mkdir -p /tmp/st && printf '{"spec":"/app/selftest/apartment.spec.json","textures":{},"models":{},"out":"/tmp/st/out","device":"CPU","report":"/tmp/st/report.json"}' > /tmp/st/params.json \
    && /opt/blender/blender -b --factory-startup --python /app/worker/factory/build.py -- /tmp/st/params.json \
    && python3 -c "import json; r=json.load(open('/tmp/st/report.json')); assert r['ok'], r; print('factory selftest', r['counts'])" \
    && rm -rf /tmp/st

# The commit this image was built from (the GHCR workflow passes github.sha); every job reports it
# as result.worker.revision. Last, so a new commit never invalidates the layers above.
ARG HM_IMAGE_REVISION=""
ENV HM_IMAGE_REVISION=${HM_IMAGE_REVISION}

CMD ["python3", "-u", "-m", "worker.serve"]
