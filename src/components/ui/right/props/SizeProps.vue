<script lang="ts" setup>
import { DefaultStage, useStageStore } from "@/stores/stage";
import { ref, watch } from "vue";
import { Lock, Unlock } from "@element-plus/icons-vue";
import MathUtils from "@/utils/MathUtils";

const stageStore = useStageStore();
const wValue = ref(DefaultStage.width);
const hValue = ref(DefaultStage.height);

watch(
  () => stageStore.width,
  newValue => {
    wValue.value = MathUtils.precise(newValue, 1);
  },
);

watch(
  () => stageStore.height,
  newValue => {
    hValue.value = MathUtils.precise(newValue, 1);
  },
);
</script>
<template>
  <div class="size-props right-props">
    <div class="size-props__title">
      <span class="size-props__title-text">尺寸</span>
    </div>

    <div class="size-props__row">
      <div class="size-props__row-item large">
        <el-input
          v-model="wValue"
          placeholder="输入数字"
          :disabled="stageStore.inputDisabled || !stageStore.widthInputEnable"
          min="2"
          type="number"
          precision="1"
          @change="value => stageStore.setElementsWidth(Number(value))"
        >
          <template #prepend>宽</template>
          <template #append>px</template>
        </el-input>
      </div>
      <div class="angle-props__row-item large">
        <el-input
          v-model="hValue"
          placeholder="输入数字"
          :disabled="stageStore.inputDisabled || !stageStore.heightInputEnable"
          min="2"
          type="number"
          precision="1"
          @change="value => stageStore.setElementsHeight(Number(value))"
        >
          <template #prepend>高</template>
          <template #append>px</template>
        </el-input>
      </div>
      <el-icon v-if="stageStore.ratioLockedEnable">
        <Unlock v-if="!stageStore.isRatioLocked" @click="stageStore.setRatioLocked(true)" title="锁定宽高比" />
        <Lock v-else @click="stageStore.setRatioLocked(false)" title="解除宽高比锁定" />
      </el-icon>
    </div>
  </div>
</template>
<style lang="less" scoped>
.size-props {
  &__row {
    .el-icon {
      cursor: pointer;
    }
  }
}
</style>
