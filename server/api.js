'use strict';

const _ = require('lodash');
const express = require('express');
const api = express();
const config = require('../config').insertJsToNextProfile;
const models = require('../models');
const { Category, Profile } = models;

// 包装 api handler
function wrap(fn) {
  return function(req, res, next) {
    fn.call(this, req, res, next).catch(next);
  };
}

const nullRes = (page, perPage) => {
  return {
    metadata: {
      count: 0,
      totalPages: 0,
      currentPage: page,
      perPage,
    },
    data: [],
  };
};

// posts api
api.get('/posts', wrap(async (req, res) => {
  // target = true 表示显示目标抓取的公众号的条目
  // mainData
  //   - = true 表示仅显示有阅读量的条目
  //   - = false 表示仅显示无阅读量的条目
  // msgBiz - 筛选特定公众号的条目，逗号分隔
  // category - 根据存储在数据库的 category id 筛选特定公众号组的内容
  // q - 搜索词
  // sortWay - 排序方式: -updateNumAt, updateNumAt, -publishAt, publishAt
  const { target, mainData, msgBiz, category: categoryId, sortWay, q, page = 1, perPage = 20 } = req.query;

  const query = {};
  // 取各个筛选条件确定的 msgBiz 交集
  const bizsArr = [];

  if (q) query.title = new RegExp(_.escapeRegExp(q), 'i');
  if (target === 'true' && config.targetBiz && config.targetBiz.length) {
    bizsArr.push(config.targetBiz);
  }
  if (mainData === 'true') query.readNum = { $exists: true };
  if (mainData === 'false') query.readNum = { $exists: false };
  if (msgBiz) bizsArr.push(msgBiz.split(','));

  if (categoryId && /^\w{24}$/.test(categoryId)) {
    const category = await models.Category.findById(categoryId);
    if (category && category.msgBizs && category.msgBizs.length) {
      bizsArr.push(category.msgBizs);
    }
  }

  if (bizsArr.length) {
    const msgBizs = _.intersection(...bizsArr);
    // 交集为空，返回给前端空数据
    if (!msgBizs.length) {
      return res.json(nullRes(page, perPage));
    }
    query.msgBiz = { $in: msgBizs };
  }

  let sortWayResult;
  switch (sortWay) {
    case '-updateNumAt':
      sortWayResult = { updateNumAt: -1 };
      break;
    case 'updateNumAt':
      sortWayResult = { updateNumAt: 1 };
      break;
    case '-publishAt':
      sortWayResult = { publishAt: -1, msgIdx: 1 };
      break;
    case 'publishAt':
      sortWayResult = { publishAt: 1, msgIdx: 1 };
      break;
    default:
      sortWayResult = { publishAt: -1, msgIdx: 1 };
      break;
  }

  let { metadata, data } = await models.Post.find(query)
    .sort(sortWayResult)
    .populate('profile')
    .paginate({ page, perPage });

  data = data.map(i => {
    let profile = null;
    if (i.profile) {
      profile = {
        title: i.profile.title || '',
        headimg: i.profile.headimg || '',
      };
    }
    return {
      id: i.id,
      title: i.title || '',
      link: i.link || '',
      publishAt: i.publishAt || null,
      msgBiz: i.msgBiz || '',
      msgIdx: i.msgIdx || '',
      readNum: i.readNum || 0,
      likeNum: i.likeNum || 0,
      updateNumAt: i.updateNumAt || null,
      profile,
    };
  });
  res.json({ metadata, data });
}));

// show post api
api.get('/posts/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const post = await models.Post.findById(id);
  res.json({ data: post.toObject() });
}));

// profiles api
api.get('/profiles', wrap(async (req, res) => {
  // target = true 表示显示目标抓取的公众号的条目
  // category - 根据存储在数据库的 category id 筛选特定公众号组的内容
  // q - 搜索词
  const { target, category: categoryId, q, page = 1, perPage = 20 } = req.query;

  const query = {};
  // 取各个筛选条件确定的 msgBiz 交集
  const bizsArr = [];

  if (q) query.title = new RegExp(_.escapeRegExp(q), 'i');
  if (target === 'true' && config.targetBiz && config.targetBiz.length) {
    bizsArr.push(config.targetBiz);
  }

  if (categoryId && /^\w{24}$/.test(categoryId)) {
    const category = await models.Category.findById(categoryId);
    if (category && category.msgBizs && category.msgBizs.length) {
      bizsArr.push(category.msgBizs);
    }
  }

  if (bizsArr.length) {
    const msgBizs = _.intersection(...bizsArr);
    // 交集为空，返回给前端空数据
    if (!msgBizs.length) {
      return res.json(nullRes(page, perPage));
    }
    query.msgBiz = { $in: msgBizs };
  }

  let { metadata, data } = await models.Profile.find(query)
    .sort({ openHistoryPageAt: -1 })
    .paginate({ page, perPage });

  data = data.map(i => ({
    id: i.id,
    openHistoryPageAt: i.openHistoryPageAt || null,
    headimg: i.headimg || '',
    msgBiz: i.msgBiz || '',
    title: i.title || '',
  }));

  // 一些额外数据，耗时
  for (const item of data) {
    let postsAllCount = 0, postsHasDataCount = 0, newestPostTime = null, oldestPostTime = null;
    if (item.msgBiz) {
      postsAllCount = await models.Post.count({ msgBiz: item.msgBiz });
      postsHasDataCount = await models.Post.count({ msgBiz: item.msgBiz, readNum: { $exists: true } });
      newestPostTime = ((await models.Post.find({ msgBiz: item.msgBiz, publishAt: { $exists: true } }).sort({ publishAt: -1 }).limit(1))[0] || {}).publishAt || null;
      oldestPostTime = ((await models.Post.find({ msgBiz: item.msgBiz, publishAt: { $exists: true } }).sort({ publishAt: 1 }).limit(1))[0] || {}).publishAt || null;
    }
    item.postsAllCount = postsAllCount;
    item.postsHasDataCount = postsHasDataCount;
    item.newestPostTime = newestPostTime;
    item.oldestPostTime = oldestPostTime;
  }

  res.json({ metadata, data });
}));

// single profile api
api.get('/profiles/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const profile = await models.Profile.findById(id);
  res.json({ data: profile.toObject() });
}));

// TODO: single profile update api
api.put('/profiles/:id', wrap(async (req, res) => {
  const { params, query } = req;
  const { id } = params;
  const { property } = query;
  if (!property) throw new Error('请传入property参数');
  await Profile.findByIdAndUpdate(id, { property });
  res.send('ok');
}));

// 新建分类
api.post('/categories', (req, res, next) => {
  const { name, msgBizs } = req.query;
  if (!name || !msgBizs) return next(new Error('请传入正确的参数'));
  Category.findOne({ name: name }).then(category => {
    if (category) return next(new Error('已存在同名称分类'));
    category = new Category({
      name,
      msgBizs: msgBizs.split(',')
    });
    return category.save();
  }).then(() => {
    res.status(201).send('创建分类成功');
  }).catch(e => {
    next(e);
  });
});

api.get('/categories', (req, res, next) => {
  Category.find({}).populate('profiles').then(categories => {
    res.json(categories);
  }).catch(e => {
    next(e);
  });
});

module.exports = api;
