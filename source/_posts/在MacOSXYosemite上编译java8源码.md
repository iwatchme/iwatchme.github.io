---
title: 在Mac OSX Yosemite上编译java8源码
date: 2016-07-14 22:32:08
tags: java
categoty: true
---
最近在看一些java比较底层的东西。工欲善其事,必先利其器，那么必须亲手编译一下java的源代码。但是在mac上编译java8的源码并不是一件一帆风顺的事情，下面记录一下踩过的坑。

#### **降级Xcode**
Mac Os X上的默认的llvm-clang编译器不支持java8源码的编译。所以我们需要下载一个老版本的XCode，其中要包含老版本的gcc编译器。
* 可以从下面链接的回答中找到老版本的XCode，本人下的是XCode4.6.3版本
http://stackoverflow.com/questions/10335747/how-to-download-xcode-4-5-6-7-8-and-get-the-dmg-or-xip-file
* 为了保证同时使用最新的Xcode。我们可以在`/Applications/`目录下面创建一个叫`Xcode4`的目录，把`Xcode.app`放入该目录下。

#### **下载jdk源码**
jdk源码是通过mercurial进行版本控制的。
* 通过 `brew install mercurial` 命令下载安装mercurial
* 下载jdk8：`hg clone http://hg.openjdk.java.net/jdk8u/jdk8u-dev/ jdk8`
* 得到jdk源码： `cd jdk8; bash get_source.sh`

#### **设置freetype**
如果没有安装freetype的话，编译过程中会报 'unable to find freetype'的错误。
* 通过：`brew cask install xquartz` 来获得freetype

#### **编译jdk源码**
执行如下命令，关键是需要制定旧版XCode的路径和freetype的路径：
`bash configure --with-xcode-path=/Applications/Xcode4/Xcode.app --with-freetype-include=/usr/X11/bin --with-freetype-lib=/usr/X11/lib`
* 如果编译过程中出现如下错误：'couldn't understand kern.osversion' or The tested number of bits in the target (0) differs from the number of bits expected to be found in the target (64)'，执行`export MACOSX_DEPLOYMENT_TARGET=10.8`，再重新编译应该就可以了

#### **编译成功**
编译成功后，生成的二进制文件可以在：`jdk8/build/macosx-x86_64-normal-server-release/images/j2sdk-image/bin`路径下找到。
