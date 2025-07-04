<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 class="text-2xl font-bold text-foreground">悬浮球设置</h2>
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="border-t border-border pt-6">
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <Label for="floating-ball-enabled">启用悬浮球</Label>
              </div>
              <Switch id="floating-ball-enabled" :model-value="settings.floatingBall.enabled"
                @update:model-value="settings.floatingBall.enabled = $event" />
            </div>
            <div class="space-y-2">
              <Label for="floating-ball-position">位置 ({{ settings.floatingBall.position }}%)</Label>
              <Slider id="floating-ball-position" :model-value="[settings.floatingBall.position]" @update:model-value="
                settings.floatingBall.position = ($event || [50])[0]
                " :min="0" :max="100" :step="1" />
            </div>
            <div class="space-y-2">
              <Label for="floating-ball-opacity">透明度 ({{ settings.floatingBall.opacity }})</Label>
              <Slider id="floating-ball-opacity" :model-value="[settings.floatingBall.opacity]" @update:model-value="
                settings.floatingBall.opacity = ($event || [1])[0]
                " :min="0.1" :max="1" :step="0.1" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { StorageManager } from '@/src/modules/storageManager';
import { UserSettings, DEFAULT_SETTINGS } from '@/src/modules/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';

const settings = ref<UserSettings>(DEFAULT_SETTINGS);
const storageManager = new StorageManager();

const emit = defineEmits<{
  saveMessage: [message: string];
}>();

onMounted(async () => {
  settings.value = await storageManager.getUserSettings();
});

watch(
  settings,
  async (newSettings) => {
    await storageManager.saveUserSettings(newSettings);
    emit('saveMessage', '设置已保存');
    browser.runtime.sendMessage({
      type: 'settings_updated',
      settings: newSettings,
    });
  },
  { deep: true },
);
</script>
