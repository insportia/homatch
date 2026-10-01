# HOMATCH Design Studio — GPU worker (Runpod Serverless).
#
# A separate compute service: it is not the Railway discovery worker and shares
# nothing with it. Built by Runpod from this directory (Dockerfile path
# infra/design-studio-gpu-worker/Dockerfile, build context the same directory).
#
#   * TRELLIS.2-4B image-to-3D (MIT code and weights), pinned commit
#   * SAM 2.1 masks (Apache-2.0)
#   * Blender 4.2 LTS, headless (the 3D factory; driven by code only)
#   * glTF-Transform 4.5.1 + KTX-Software 4.4.2 + Khronos validator (same toolchain as the catalogue)
#
# No secrets at build time. Weights are prepared on first start into the
# Runpod network volume when one is attached (/runpod-volume), else into the
# container disk; the gated DINOv3 encoder needs HF_TOKEN as an endpoint secret.

FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel

ARG TRELLIS2_COMMIT=main
ARG SAM2_COMMIT=main
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0" \
    OPENCV_IO_ENABLE_OPENEXR=1 \
    HM_BLENDER=/opt/blender/blender

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl wget ca-certificates xz-utils build-essential ninja-build \
      libgl1 libglib2.0-0 libxi6 libxrender1 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3 libegl1 \
    && rm -rf /var/lib/apt/lists/*

# Node 20 + the glTF toolchain (pinned like .github/workflows/design-studio-catalog.yml).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/* \
    && npm install -g --no-audit --no-fund @gltf-transform/cli@4.5.1 \
    && mkdir -p /opt/hm-node && npm install --prefix /opt/hm-node --no-audit --no-fund gltf-validator@2.0.0-dev.3.10
ENV NODE_PATH=/opt/hm-node/node_modules
RUN curl -fsSL -o /tmp/ktx.deb https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Linux-x86_64.deb \
    && apt-get update && apt-get install -y /tmp/ktx.deb && rm -f /tmp/ktx.deb && rm -rf /var/lib/apt/lists/* && ktx --version

# Blender 4.2 LTS (headless).
RUN curl -fsSL https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz -o /tmp/blender.tar.xz \
    && mkdir -p /opt/blender && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && rm /tmp/blender.tar.xz \
    && /opt/blender/blender -b --factory-startup --python-expr "import bpy; print(bpy.app.version_string)"

# TRELLIS.2 and its compiled extensions (no new conda env: this image's Python and torch).
RUN git clone --recursive https://github.com/microsoft/TRELLIS.2.git /opt/trellis2 && cd /opt/trellis2 && git checkout ${TRELLIS2_COMMIT} \
    && bash -c ". ./setup.sh --basic --flash-attn --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm"
ENV PYTHONPATH=/opt/trellis2:/app

# SAM 2.1.
RUN pip install --no-cache-dir "git+https://github.com/facebookresearch/sam2.git@${SAM2_COMMIT}"

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY worker /app/worker
WORKDIR /app

CMD ["python", "-u", "-m", "worker.serve"]
