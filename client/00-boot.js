/**
 * Shoreline —— 客户端半边：DSH 设置里的「Shoreline」面板。
 *
 * 一期只装记忆：总览、检索、单条强度、回想/忘掉、注入块预览。
 * 二期这里会长出「桥接」和「人格」两个页签，所以顶层用 tabs 结构占好位置。
 *
 * 数据流：本组件 ⇄ /dsh-shoreline/api/*（同源 fetch）⇄ 宿主进程的记忆库文件。
 * Client 侧没有直连 Host 的 Service 通道，这是唯一可行路径（SurfCore 同款）。
 */
window.__ModuleLoader__.load({
  id: 'shoreline',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const { createElement: h, useCallback, useEffect, useMemo, useState } = React;

    const API = '/dsh-shoreline/api';
    const CSS_TAG = 'shoreline/panel.css';
