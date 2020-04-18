---
title: ListView究竟是如何工作的?
date: 2016-06-11 15:53:02
tags: android, view
categoty: true
---
# ListView和Adapter
listview通过adapter来加载每个item的布局,其中最重要的是getView函数，返回的是一个View对象，不同的UI视图都是View的子类。通过依赖抽象和adapter模式，保证了AbsListView的高度定制形式。

下面是adapter的一个典型代码片段:

<!-- more -->
```java
   public class myAdapter  extends BaseAdapter {
        
        private ArrayList<String> mFoodList;
        private Context mContext;
        
        class Holder {
            TextView foodName;
        }
        
        public myAdapter(Context context, ArrayList<String> foodlist) {
            mFoodList = foodlist;
            mContext = context;
        }

        @Override
        public int getCount() {
            return mFoodList.size();
        }

        @Override
        public Object getItem(int position) {
            return mFoodList.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            Holder holder;
            if (convertView == null) {
                holder = new Holder();
                convertView = LayoutInflater.from(mContext).inflate(R.drawable.list_item, null);
                holder.foodName = (TextView) convertView.findViewById(R.id.name);
                convertView.setTag(holder);
            } else {
                holder = (Holder)convertView.getTag();
            }
            String name = mFoodList.get(position);
            holder.foodName.setText(name);
            return convertView;
        }
    }
```

# RecyclerBin机制
 这是listView不会OOM的关键，这是absListView的内部类，代码如下：

* mActiveViews:存储的是屏幕上可见View的集合

* mScrapViews: 只有一种View类型下，废弃View的集合
  mCurrentScrap: 在有多种View类型下，废弃View的集合

* fillActiveViews() 将ListView中的可见View存储到mActiveViews数组当中。

* getActiveView() 这个方法和fillActiveViews()是对应的，用于从mActiveViews数组当中获取数据。需要注意的是，mActiveViews当中所存储的View，一旦被取出后后就会从mActiveViews当中移除(第36行，置为null)，也就是说mActiveViews不能被重复利用。

* addScrapView() 用于将一个废弃View进行缓存，该方法接收一个View参数，当有某个View确定要废弃掉的时候(比如滚动出了屏幕)，就应该调用这个方法来对View进行缓存，RecycleBin当中使用mScrapViews和mCurrentScrap这两个List来存储废弃View, 两者之间的区别已经在上面说明。

* getScrapView 用于从废弃缓存中取出一个View，同样根据数据项是否是多种类型分别对应使用mScrapeViews或者mCurrentScrapeView。需要注意的是这些废弃缓存中的View并没有特定的顺序。

* setViewTypeCount() Adapter中通过重写getViewTypeCount()来表示ListView中有几种类型的数据项，而setViewTypeCount()通过调用该方法来为每种类型的数据项都单独启用一个RecycleBin缓存机制。

```java
class RecycleBin {
	private RecyclerListener mRecyclerListener;

	private int mFirstActivePosition;

	private View[] mActiveViews = new View[0];

	private ArrayList<View>[] mScrapViews;

	private int mViewTypeCount;

	private ArrayList<View> mCurrentScrap;


 fillActiveViews(int childCount, int firstActivePosition) {
		if (mActiveViews.length < childCount) {
			mActiveViews = new View[childCount];
		}
		mFirstActivePosition = firstActivePosition;
		final View[] activeViews = mActiveViews;
		for (int i = 0; i < childCount; i++) {
			View child = getChildAt(i);
			AbsListView.LayoutParams lp = (AbsListView.LayoutParams) child.getLayoutParams();
			if (lp != null && lp.viewType != ITEM_VIEW_TYPE_HEADER_OR_FOOTER) {
				activeViews[i] = child;
			}
		}
	}

	View getActiveView(int position) {
		int index = position - mFirstActivePosition;
		final View[] activeViews = mActiveViews;
		if (index >= 0 && index < activeViews.length) {
			final View match = activeViews[index];
			activeViews[index] = null;
			return match;
		}
		return null;
	}

	void addScrapView(View scrap) {
		AbsListView.LayoutParams lp = (AbsListView.LayoutParams) scrap.getLayoutParams();
		if (lp == null) {
			return;
		}
		// Don't put header or footer views or views that should be ignored
		// into the scrap heap
		int viewType = lp.viewType;
		if (!shouldRecycleViewType(viewType)) {
			if (viewType != ITEM_VIEW_TYPE_HEADER_OR_FOOTER) {
				removeDetachedView(scrap, false);
			}
			return;
		}
		if (mViewTypeCount == 1) {
			dispatchFinishTemporaryDetach(scrap);
			mCurrentScrap.add(scrap);
		} else {
			dispatchFinishTemporaryDetach(scrap);
			mScrapViews[viewType].add(scrap);
		}

		if (mRecyclerListener != null) {
			mRecyclerListener.onMovedToScrapHeap(scrap);
		}
	}


	View getScrapView(int position) {
		ArrayList<View> scrapViews;
		if (mViewTypeCount == 1) {
			scrapViews = mCurrentScrap;
			int size = scrapViews.size();
			if (size > 0) {
				return scrapViews.remove(size - 1);
			} else {
				return null;
			}
		} else {
			int whichScrap = mAdapter.getItemViewType(position);
			if (whichScrap >= 0 && whichScrap < mScrapViews.length) {
				scrapViews = mScrapViews[whichScrap];
				int size = scrapViews.size();
				if (size > 0) {
					return scrapViews.remove(size - 1);
				}
			}
		}
		return null;
	}

	public void setViewTypeCount(int viewTypeCount) {
		if (viewTypeCount < 1) {
			throw new IllegalArgumentException("Can't have a viewTypeCount < 1");
		}
		// noinspection unchecked
		ArrayList<View>[] scrapViews = new ArrayList[viewTypeCount];
		for (int i = 0; i < viewTypeCount; i++) {
			scrapViews[i] = new ArrayList<View>();
		}
		mViewTypeCount = viewTypeCount;
		mCurrentScrap = scrapViews[0];
		mScrapViews = scrapViews;
	}}
```

# listView的setAdapter过程

* 如果使用addHeaderView或addFooterView方法后，mHeaderViewInfos或mFooterViewInfos添加对应header或footer的信息，此时会将传入的adapter封装成HeaderViewListAdapter。

* BaseAdapter中有DataSetObservable对象，listView中有AdapterDataSetObserver。当setAdapter的时候，会将AdapterDataSetObserver注册进DataSetObservable中。当调用adapter的notifyDataSetChanged方法时，即相当于调用DataSetObservable对象的notifyChanged方法，遍历所有观察者，调用它们的onChanged方法，在onChanged方法中将会调用ListView的requestLayout()刷新布局。这是一个典型的观察者模式。

```java
    @Override
    public void setAdapter(ListAdapter adapter) {
        if (mAdapter != null && mDataSetObserver != null) {
            mAdapter.unregisterDataSetObserver(mDataSetObserver);
        }

        resetList();
        mRecycler.clear();

        if (mHeaderViewInfos.size() > 0|| mFooterViewInfos.size() > 0) {
            mAdapter = new HeaderViewListAdapter(mHeaderViewInfos, mFooterViewInfos, adapter);
        } else {
            mAdapter = adapter;
        }

        mOldSelectedPosition = INVALID_POSITION;
        mOldSelectedRowId = INVALID_ROW_ID;

        // AbsListView#setAdapter will update choice mode states.
        super.setAdapter(adapter);

        if (mAdapter != null) {
            mOldItemCount = mItemCount;
            mItemCount = mAdapter.getCount();
            checkFocus();

            mDataSetObserver = new AdapterDataSetObserver();
            mAdapter.registerDataSetObserver(mDataSetObserver);

            mRecycler.setViewTypeCount(mAdapter.getViewTypeCount());

            int position;
            if (mStackFromBottom) {
                position = lookForSelectablePosition(mItemCount - 1, false);
            } else {
                position = lookForSelectablePosition(0, true);
            }
        } else {
            mAreAllItemsSelectable = true;
            checkFocus();
            // Nothing selected
            checkSelectionChanged();
        }
        requestLayout();
    }
```

# ListView的第一次布局和第二次布局（Layout）

* onMeasure或OnLayout至少会经历至少两次measure和layout的过程,具体原因可以点击链接
  [链接](http://developer.android.com/intl/ja/guide/topics/ui/how-android-draws.html)

* 第一次Layout(假设从上往下布局)
 *  listView的layout函数会去调用layoutChildren函数(见code1)
 
 *  第14行childCount为0(因为此时没有任何一个item添加到listView中)，此时调用41行的fillFromTop(int)(见code2)。
 
 *  fillFromTop会调用fillDown(int,int)，用来将item填充到listView的可见区域内。
 
    *  nextTop: 每个元素顶部距离整个ListView顶部的像素值，第一次传入的值为layoutChildren中的childrenTop
    
    *  pos: mFirstPosition的值
    
    *  end: ListView底部减去顶部所得的像素值
    
    *  mItemCount: Adapter中的元素数量
    
    *  因此一开始的情况下nextTop必定小于end同时pos也小于mItemCount，每执行一次while循环，pos的值都会加1，并且nextTop也会增加。当nextTop<=end时(子元素已经超出当前ListView的可见范围)或者pos>=mItemCount时所有item都被遍历了)就会结束循环。
    
  *  在每次循环中，调用makeAndAddView函数来得到具体的item(见code3)。
    
    * 从mRecycler中得到activeView，结果为null。进而调用19行的obtainView()和22行的 setupChild()
    
    * obtainView是整个listView的关键，所有具体的子View都是从这个函数中得到的。这时从mRecycler中得到scrapView也为null，这时会调用adapter的getView函数,注意第2个参数就是我们常常看到的convertView，此时就会会调用LayoutInflater的inflate()方法来去加载一个布局(Woohu, 终于知道adapter中的getView的出处了)。
    
    * 最后调用setupChild(),注意最后一个参数为false(obtainView函数中设置)，即recycled== false。所以会调用17行的addViewInLayout将子View加载入listview。
    
  * 第一次layout过程当中，所有的子View都是调用LayoutInflater的inflate()方法加载出来的，这样就会相对比较耗时
    
* 第二次Layout
  * 第14行的childCount不为0。同时layoutChildren第26行的RecycleBin的fillActiveViews函数也会往mActiveViews数组中添加目前所有可视的子View。
  
  * 接下来调用detachAllViewsFromParent()，这个方法会将所有ListView当中的子View全部清除掉，从而保证第二次Layout过程不会产生一份重复的数据。
  
  * 接下来会调用52行的fillSpecific()，fillSpecific()方法会优先将指定位置的子View先加载到屏幕上，然后再加载该子View往上以及往下的其它子View。这里假设传入的是第一个view的位置(position == 0)，所以实质上又是调用fillDown()。
  
  * 这时调用makeAndAddView函数会和第一次有所不同。
  
  * 从mRecycler中得到activeView，结果不为null。进而调用12行的setupChild()。注意此时最后一个参数为true。因此会调 attachViewToParent(），与之前的detachAllViewsFromParent()相对应，经历过detach又attach的过程后，所有可见子View又都正常显示了。

** code1 layoutChildren  **

```java
    @Override
    protected void layoutChildren() {
        final boolean blockLayoutRequests = mBlockLayoutRequests;
        if (blockLayoutRequests) {
            return;
        }
        mBlockLayoutRequests = true;

        try {
            super.layoutChildren();

            final int childrenTop = mListPadding.top;
            final int childrenBottom = mBottom - mTop - mListPadding.bottom;
            final int childCount = getChildCount();


            // Pull all children into the RecycleBin.
            // These views will be reused if possible
            final int firstPosition = mFirstPosition;
            final RecycleBin recycleBin = mRecycler;
            if (dataChanged) {
                for (int i = 0; i < childCount; i++) {
                    recycleBin.addScrapView(getChildAt(i), firstPosition+i);
                }
            } else {
                recycleBin.fillActiveViews(childCount, firstPosition);
            }

            // Clear out old views
            detachAllViewsFromParent();
            recycleBin.removeSkippedScrap();

            switch (mLayoutMode) {
            case LAYOUT_SET_SELECTION:
                     ...
            default:
                if (childCount == 0) {
                    if (!mStackFromBottom) {
                        final int position = lookForSelectablePosition(0, true);
                        setSelectedPositionInt(position);
                        sel = fillFromTop(childrenTop);
                    } else {
                        final int position = lookForSelectablePosition(mItemCount - 1, false);
                        setSelectedPositionInt(position);
                        sel = fillUp(mItemCount - 1, childrenBottom);
                    }
                } else {
                    if (mSelectedPosition >= 0 && mSelectedPosition < mItemCount) {
                        sel = fillSpecific(mSelectedPosition,
                                oldSel == null ? childrenTop : oldSel.getTop());
                    } else if (mFirstPosition < mItemCount) {
                        sel = fillSpecific(mFirstPosition,
                                oldFirst == null ? childrenTop : oldFirst.getTop());
                    } else {
                        sel = fillSpecific(0, childrenTop);
                    }
                }
                break;
            }
            recycleBin.scrapActiveViews();
    }
  }
```

**  code2 fillDown**

```java
    private View fillDown(int pos, int nextTop) {
        View selectedView = null;

        int end = (mBottom - mTop);
        if ((mGroupFlags & CLIP_TO_PADDING_MASK) == CLIP_TO_PADDING_MASK) {
            end -= mListPadding.bottom;
        }

        while (nextTop < end && pos < mItemCount) {
            // is this the selected item?
            boolean selected = pos == mSelectedPosition;
            View child = makeAndAddView(pos, nextTop, true, mListPadding.left, selected);

            nextTop = child.getBottom() + mDividerHeight;
            if (selected) {
                selectedView = child;
            }
            pos++;
        }

        setVisibleRangeHint(mFirstPosition, mFirstPosition + getChildCount() - 1);
        return selectedView;
    }
```

**code3 makeAndAddView**

```java
    private View makeAndAddView(int position, int y, boolean flow, int childrenLeft,
            boolean selected) {
        View child;


        if (!mDataChanged) {
            // Try to use an existing view for this position
            child = mRecycler.getActiveView(position);
            if (child != null) {
                // Found it -- we're using an existing child
                // This just needs to be positioned
                setupChild(child, position, y, flow, childrenLeft, selected, true);

                return child;
            }
        }

        // Make a new view for this position, or convert an unused view if possible
        child = obtainView(position, mIsScrap);

        // This needs to be positioned and measured
        setupChild(child, position, y, flow, childrenLeft, selected, mIsScrap[0]);

        return child;
    }
```

**code4 obtainView**

```java
View obtainView(int position, boolean[] isScrap) {
    isScrap[0] = false;

    final View scrapView = mRecycler.getScrapView(position);
    final View child = mAdapter.getView(position, scrapView, this);
    if (scrapView != null) {
        if (child != scrapView) {
            // Failed to re-bind the data, return scrap to the heap.
            mRecycler.addScrapView(scrapView, position);
        } else {
            isScrap[0] = true;

            child.dispatchFinishTemporaryDetach();
        }
    }
    return child;
}
```

**code5 setupChild**

```java
    private void setupChild(View child, int position, int y, boolean flowDown, int childrenLeft,boolean selected, boolean recycled) {
                               ...
        AbsListView.LayoutParams p = (AbsListView.LayoutParams) child.getLayoutParams();
        if (p == null) {
            p = (AbsListView.LayoutParams) generateDefaultLayoutParams();
        }
        p.viewType = mAdapter.getItemViewType(position);

        if ((recycled && !p.forceAdd) || (p.recycledHeaderFooter &&
                p.viewType == AdapterView.ITEM_VIEW_TYPE_HEADER_OR_FOOTER)) {
            attachViewToParent(child, flowDown ? -1 : 0, p);
        } else {
            p.forceAdd = false;
            if (p.viewType == AdapterView.ITEM_VIEW_TYPE_HEADER_OR_FOOTER) {
                p.recycledHeaderFooter = true;
            }
            addViewInLayout(child, flowDown ? -1 : 0, p, true);
        }
                             ...
    }
```

**code6 fillSpecific**

```java
    private View fillSpecific(int position, int top) {
        boolean tempIsSelected = position == mSelectedPosition;
        View temp = makeAndAddView(position, top, true, mListPadding.left, tempIsSelected);
        // Possibly changed again in fillUp if we add rows above this one.
        mFirstPosition = position;

        View above;
        View below;

        final int dividerHeight = mDividerHeight;
        if (!mStackFromBottom) {
            above = fillUp(position - 1, temp.getTop() - dividerHeight);
            // This will correct for the top of the first view not touching the top of the list
            adjustViewsUpOrDown();
            below = fillDown(position + 1, temp.getBottom() + dividerHeight);
            int childCount = getChildCount();
            if (childCount > 0) {
                correctTooHigh(childCount);
            }
        } else {
            below = fillDown(position + 1, temp.getBottom() + dividerHeight);
            // This will correct for the bottom of the last view not touching the bottom of the list
            adjustViewsUpOrDown();
            above = fillUp(position - 1, temp.getTop() - dividerHeight);
            int childCount = getChildCount();
            if (childCount > 0) {
                 correctTooLow(childCount);
            }
        }

        if (tempIsSelected) {
            return temp;
        } else if (above != null) {
            return above;
        } else {
            return below;
        }
    }
```

# ListView的滚动过程

上面展示了listView如何显示了第一屏的数据，下面说明listView如何滚动显示数据。

* 滚动时函数的调用顺序为:
  * onTouchEvent
  * onTouchMove()
  * scrollIfNeeded()

* scrollIfNeeded函数(见code7)中:
  *  incrementalDeltaY: 手指移动的距离。>0表示向下滑；<0表示向上滑
  
* trackMotionScroll函数(见code8)中:
  * 关于firstTop、lastBottom、spaceAbove、 spaceBelow 的含义见图1
  
  * 当cannotScrollDown或者cannotScrollUp 为true时，表示无法下滑或者上滑，则直接返回(53~60行)。
  
  * 这里假设项下滑，则会进入else中。这时由于是下滑，底部的View可能划出屏幕范围，为了得到划出屏幕的View，从底部的View向上遍历，当子View的top小于bottom时，说明被移除了。通过调用addScrapView函数将该子View加入mRecycler的mCurrentScrap或 mScrapViews中。
  
  * 通过offsetChildrenTopAndBottom(incrementalDeltaY)(第134行)将仍然可见的子Views移动相应的距离，移动的方式就是改变每个子View的mTop和mBottom属性。
  
  * 这时如果spaceAbove < absIncrementalDeltaY或者spaceBelow < absIncrementalDeltaY，就说明会有新的子View变得可见，将会进入屏幕，这时会调用fillGap函数来填充这段间隙。
  
* fillGap(见code9)函数中:

  *  startOffset:得到上面空隙(Gap)的距离。
  
  *  这时会调用fillUp函数，然后又看到了熟悉的makeAndAddView函数。该方法仍然会尝试调用RecycleBin的getActiveView()方法来获取子布局，但由于在第二次Layout过程中我们已经从mActiveViews中获取过了数据而且mActiveViews是不能够重复利用的，因此这里返回的是null
  
  *  这时会调用obtainView。而在第5行getScrapView时，这时就不在为null，因为刚才有废弃的View加入到mCurrentScrap或mScrapViews中了。这时在调用adapter的getView时就会使用convertView!=null的那段逻辑了，只需要把convertView中的数据更新成当前位置上应该显示的数据，那么看起来就好像是全新加载出来的一个布局一样。
  
  * 这是一个典型的生产者-消费者模型。

  * 至此整个listView的一个滑动过程就算结束了

![](img/5CD2F67B54C1315CAF1F2236303141EA.jpg)

** code7 scrollIfNeeded()**

```java
 private void scrollIfNeeded(int x, int y, MotionEvent vtev) {
        int rawDeltaY = y - mMotionY;
    
        final int deltaY = rawDeltaY;
        int incrementalDeltaY =
                mLastY != Integer.MIN_VALUE ? y - mLastY + scrollConsumedCorrection : deltaY;
        int lastYCorrection = 0;

        if (mTouchMode == TOUCH_MODE_SCROLL) {
            if (y != mLastY) {

                final int motionIndex;
                if (mMotionPosition >= 0) {
                    motionIndex = mMotionPosition - mFirstPosition;
                } else {
                    motionIndex = getChildCount() / 2;
                }

                int motionViewPrevTop = 0;
                View motionView = this.getChildAt(motionIndex);
                if (motionView != null) {
                    motionViewPrevTop = motionView.getTop();
                }

                // No need to do all this work if we're not going to move anyway
                boolean atEdge = false;
                if (incrementalDeltaY != 0) {
                    atEdge = trackMotionScroll(deltaY, incrementalDeltaY);
                }

                // Check to see if we have bumped into the scroll limit
                motionView = this.getChildAt(motionIndex);
                if (motionView != null) {
                    final int motionViewRealTop = motionView.getTop();
                    if (atEdge) {
                        // Apply overscroll
                    }
                    mMotionY = y + lastYCorrection + scrollOffsetCorrection;
                }
                mLastY = y + lastYCorrection + scrollOffsetCorrection;
            }
        } else if (mTouchMode == TOUCH_MODE_OVERSCROLL) {
 
        }
    }

```

**code8 trackMotionScroll**

```java
    boolean trackMotionScroll(int deltaY, int incrementalDeltaY) {
        final int childCount = getChildCount();
        if (childCount == 0) {
            return true;
        }

        final int firstTop = getChildAt(0).getTop();
        final int lastBottom = getChildAt(childCount - 1).getBottom();

        final Rect listPadding = mListPadding;

        // "effective padding" In this case is the amount of padding that affects
        // how much space should not be filled by items. If we don't clip to padding
        // there is no effective padding.
        int effectivePaddingTop = 0;
        int effectivePaddingBottom = 0;
        if ((mGroupFlags & CLIP_TO_PADDING_MASK) == CLIP_TO_PADDING_MASK) {
            effectivePaddingTop = listPadding.top;
            effectivePaddingBottom = listPadding.bottom;
        }

         // FIXME account for grid vertical spacing too?
        final int spaceAbove = effectivePaddingTop - firstTop;
        final int end = getHeight() - effectivePaddingBottom;
        final int spaceBelow = lastBottom - end;

        final int height = getHeight() - mPaddingBottom - mPaddingTop;
        if (deltaY < 0) {
            deltaY = Math.max(-(height - 1), deltaY);
        } else {
            deltaY = Math.min(height - 1, deltaY);
        }

        if (incrementalDeltaY < 0) {
            incrementalDeltaY = Math.max(-(height - 1), incrementalDeltaY);
        } else {
            incrementalDeltaY = Math.min(height - 1, incrementalDeltaY);
        }

        final int firstPosition = mFirstPosition;

        // Update our guesses for where the first and last views are
        if (firstPosition == 0) {
            mFirstPositionDistanceGuess = firstTop - listPadding.top;
        } else {
            mFirstPositionDistanceGuess += incrementalDeltaY;
        }
        if (firstPosition + childCount == mItemCount) {
            mLastPositionDistanceGuess = lastBottom + listPadding.bottom;
        } else {
            mLastPositionDistanceGuess += incrementalDeltaY;
        }

        final boolean cannotScrollDown = (firstPosition == 0 &&
                firstTop >= listPadding.top && incrementalDeltaY >= 0);
        final boolean cannotScrollUp = (firstPosition + childCount == mItemCount &&
                lastBottom <= getHeight() - listPadding.bottom && incrementalDeltaY <= 0);

        if (cannotScrollDown || cannotScrollUp) {
            return incrementalDeltaY != 0;
        }

        final boolean down = incrementalDeltaY < 0; //当大于0时，向下滑动，down为false，意思为在上边填充; 小于0时，意思为在下边填充

        final boolean inTouchMode = isInTouchMode();
        if (inTouchMode) {
            hideSelector();
        }

        final int headerViewsCount = getHeaderViewsCount();
        final int footerViewsStart = mItemCount - getFooterViewsCount();

        int start = 0;
        int count = 0;

        if (down) {
            int top = -incrementalDeltaY;
            if ((mGroupFlags & CLIP_TO_PADDING_MASK) == CLIP_TO_PADDING_MASK) {
                top += listPadding.top;
            }
            for (int i = 0; i < childCount; i++) {
                final View child = getChildAt(i);
                if (child.getBottom() >= top) {
                    break;
                } else {
                    count++;
                    int position = firstPosition + i;
                    if (position >= headerViewsCount && position < footerViewsStart) {
                        // The view will be rebound to new data, clear any
                        // system-managed transient state.
                        child.clearAccessibilityFocus();
                        mRecycler.addScrapView(child, position);
                    }
                }
            }
        } else {
            int bottom = getHeight() - incrementalDeltaY;
            if ((mGroupFlags & CLIP_TO_PADDING_MASK) == CLIP_TO_PADDING_MASK) {
                bottom -= listPadding.bottom;
            }
            for (int i = childCount - 1; i >= 0; i--) {
                final View child = getChildAt(i);
                if (child.getTop() <= bottom) {
                    break;
                } else {
                    start = i;
                    count++;
                    int position = firstPosition + i;
                    if (position >= headerViewsCount && position < footerViewsStart) {
                        // The view will be rebound to new data, clear any
                        // system-managed transient state.
                        child.clearAccessibilityFocus();
                        mRecycler.addScrapView(child, position);
                    }
                }
            }
        }

        mMotionViewNewTop = mMotionViewOriginalTop + deltaY;

        mBlockLayoutRequests = true;

        if (count > 0) {
            detachViewsFromParent(start, count);
            mRecycler.removeSkippedScrap();
        }

        // invalidate before moving the children to avoid unnecessary invalidate
        // calls to bubble up from the children all the way to the top
        if (!awakenScrollBars()) {
           invalidate();
        }

        offsetChildrenTopAndBottom(incrementalDeltaY);

        if (down) {
            mFirstPosition += count;
        }

        final int absIncrementalDeltaY = Math.abs(incrementalDeltaY);
        if (spaceAbove < absIncrementalDeltaY || spaceBelow < absIncrementalDeltaY) {
            fillGap(down);
        }

        if (!inTouchMode && mSelectedPosition != INVALID_POSITION) {
            final int childIndex = mSelectedPosition - mFirstPosition;
            if (childIndex >= 0 && childIndex < getChildCount()) {
                positionSelector(mSelectedPosition, getChildAt(childIndex));
            }
        } else if (mSelectorPosition != INVALID_POSITION) {
            final int childIndex = mSelectorPosition - mFirstPosition;
            if (childIndex >= 0 && childIndex < getChildCount()) {
                positionSelector(INVALID_POSITION, getChildAt(childIndex));
            }
        } else {
            mSelectorRect.setEmpty();
        }

        mBlockLayoutRequests = false;

        invokeOnItemScrollListener();

        return false;
    }
```

**code9 fillGap**

```java
    void fillGap(boolean down) {
        final int count = getChildCount();
        if (down) {
            int paddingTop = 0;
            if ((mGroupFlags & CLIP_TO_PADDING_MASK) == CLIP_TO_PADDING_MASK) {
                paddingTop = getListPaddingTop();
            }
            final int startOffset = count > 0 ? getChildAt(count - 1).getBottom() + mDividerHeight :
                    paddingTop;
            fillDown(mFirstPosition + count, startOffset);
            correctTooHigh(getChildCount());
        } else {
            int paddingBottom = 0;
            if ((mGroupFlags & CLIP_TO_PADDING_MASK) == CLIP_TO_PADDING_MASK) {
                paddingBottom = getListPaddingBottom();
            }
            final int startOffset = count > 0 ? getChildAt(0).getTop() - mDividerHeight : getHeight() - paddingBottom;
            fillUp(mFirstPosition - 1, startOffset);
            correctTooLow(getChildCount());
        }
    }
```

**code10 fillUp**

```java
private View fillUp(int pos, int nextBottom) {
    View selectedView = null;

    int end = 0;
    if ((mGroupFlags & CLIP_TO_PADDING_MASK) == CLIP_TO_PADDING_MASK) {
        end = mListPadding.top;
    }

    while (nextBottom > end && pos >= 0) {
        // is this the selected item?
        boolean selected = pos == mSelectedPosition;
        View child = makeAndAddView(pos, nextBottom, false, mListPadding.left, selected);
        nextBottom = child.getTop() - mDividerHeight;
        if (selected) {
            selectedView = child;
        }
        pos--;
    }

    mFirstPosition = pos + 1;
    setVisibleRangeHint(mFirstPosition, mFirstPosition + getChildCount() - 1);
    return selectedView;
}
```