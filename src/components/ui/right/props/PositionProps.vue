<script lang="ts" setup>
import { DefaultStage, useStageStore } from "@/stores/stage";
import MathUtils from "@/utils/MathUtils";
import { ref, watch } from "vue";

const stageStore = useStageStore();
const xValue = ref(DefaultStage.position.x);
const yValue = ref(DefaultStage.position.y);

watch(
  () => stageStore.position,
  newValue => {
    if (newValue) {
      xValue.value = MathUtils.precise(newValue.x);
      yValue.value = MathUtils.precise(newValue.y);
    }
  },
);
</script>
<template>
  <div class="position-props right-props">
    <div class="position-props__title">坐标</div>

    <div class="position-props__row">
      <div class="angle-props__row-item large">
        <el-input
          v-model="xValue"
          placeholder="输入数字"
          :disabled="stageStore.inputDisabled || !stageStore.positionInputEnable"
          type="number"
          precision="1"
          @change="value => stageStore.setElementsPosition({ x: Number(value), y: yValue })"
        >
          <template #prepend>横</template>
          <template #append>px</template>
        </el-input>
      </div>

      <div class="angle-props__row-item large">
        <el-input
          v-model="yValue"
          placeholder="输入数字"
          :disabled="stageStore.inputDisabled || !stageStore.positionInputEnable"
          type="number"
          precision="1"
          @change="value => stageStore.setElementsPosition({ x: xValue, y: Number(value) })"
        >
          <template #prepend>纵</template>
          <template #append>px</template>
        </el-input>
      </div>
    </div>
  </div>
</template>
